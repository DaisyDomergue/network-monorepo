import { wait } from 'streamr-test-utils'
import { StreamMessage } from 'streamr-client-protocol'
import {
    describeRepeats, fakePrivateKey, Msg, Debug, addAfterFn, getPublishTestStreamMessages, publishTestMessagesGenerator, createTestStream
} from '../utils'
import { Defer } from '../../src/utils'
import { BrubeckClient } from '../../src/BrubeckClient'
import { GroupKey } from '../../src/encryption/Encryption'
import { Stream, StreamOperation } from '../../src/Stream'
import Subscription from '../../src/Subscription'
import { StorageNode } from '../../src/StorageNode'

import clientOptions from './config'

const debug = Debug('BrubeckClient::test')
const TIMEOUT = 15 * 1000
const NUM_MESSAGES = 5

describeRepeats('decryption', () => {
    let publishTestMessages: ReturnType<typeof getPublishTestStreamMessages>
    let expectErrors = 0 // check no errors by default
    let errors: Error[] = []

    let publisher: BrubeckClient
    let subscriber: BrubeckClient
    let stream: Stream
    const addAfter = addAfterFn()

    const createClient = (opts: any = {}) => {
        const c = new BrubeckClient({
            ...clientOptions,
            auth: {
                privateKey: fakePrivateKey(),
            },
            autoConnect: false,
            autoDisconnect: false,
            disconnectDelay: 1,
            publishAutoDisconnectDelay: 50,
            maxRetries: 2,
            ...opts,
        })

        addAfter(() => (
            cleanupClient(c)
        ))

        return c
    }

    async function cleanupClient(client?: BrubeckClient, msg = 'disconnecting after test') {
        await wait(0)
        if (client) {
            client.debug(msg)
            await client.destroy()
        }
    }

    function checkEncryptionMessages(testClient: BrubeckClient) {
        const onSendTest = Defer()
        testClient.publisher.publishQueue.forEach(onSendTest.wrapError(async ([streamMessage]) => {
            // check encryption is as expected
            if (streamMessage.messageType === StreamMessage.MESSAGE_TYPES.MESSAGE) {
                expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.AES)
            } else if (streamMessage.messageType === StreamMessage.MESSAGE_TYPES.GROUP_KEY_RESPONSE) {
                expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.RSA)
            } else {
                expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.NONE)
            }
        })).onFinally(() => {
            onSendTest.resolve(undefined)
        })

        return onSendTest
    }

    beforeEach(() => {
        errors = []
        expectErrors = 0
    })

    afterEach(async () => {
        await wait(0)
        // ensure no unexpected errors
        expect(errors).toHaveLength(expectErrors)
        // if (publisher) {
        // expect(publisher.onError).toHaveBeenCalledTimes(expectErrors)
        // }
    })

    async function setupClient(opts?: any) {
        const client = createClient(opts)
        await Promise.all([
            client.session.getSessionToken(),
            client.connect(),
        ])
        return client
    }

    async function setupStream() {
        stream = await createTestStream(publisher, module, {
            requireEncryptedData: true,
        })

        await stream.addToStorageNode(StorageNode.STREAMR_DOCKER_DEV)

        publishTestMessages = getPublishTestStreamMessages(publisher, stream)
    }

    async function setupPublisherSubscriberClients(opts?: any) {
        debug('set up clients', opts)
        if (publisher) {
            debug('disconnecting old publisher')
            await publisher.destroy()
        }

        if (subscriber) {
            debug('disconnecting old subscriber')
            await subscriber.destroy()
        }

        // eslint-disable-next-line require-atomic-updates, semi-style, no-extra-semi
        ;[publisher, subscriber] = await Promise.all([
            setupClient({ id: 'publisher', ...opts }),
            setupClient({ id: 'subscriber', ...opts }),
        ])
    }

    async function grantSubscriberPermissions({ stream: s = stream, client: c = subscriber }: { stream?: Stream, client?: BrubeckClient } = {}) {
        const p1 = await s.grantPermission(StreamOperation.STREAM_GET, await c.getAddress())
        const p2 = await s.grantPermission(StreamOperation.STREAM_SUBSCRIBE, await c.getAddress())
        return [p1, p2]
    }

    describe('using default config', () => {
        beforeEach(async () => {
            await setupPublisherSubscriberClients()
        })

        beforeEach(async () => {
            await setupStream()
        })

        describe('subscriber has permissions', () => {
            beforeEach(async () => {
                await grantSubscriberPermissions()
            })

            it('client.subscribe can decrypt encrypted messages if it knows the group key', async () => {
                const groupKey = GroupKey.generate()
                const keys = {
                    [stream.id]: {
                        [groupKey.id]: groupKey,
                    }
                }
                const msg = Msg()
                const done = Defer()
                await subscriber.subscribe({
                    stream: stream.id,
                    // @ts-expect-error
                    groupKeys: keys,
                }, done.wrap((parsedContent, streamMessage) => {
                    expect(parsedContent).toEqual(msg)
                    // Check signature stuff
                    expect(streamMessage.signatureType).toBe(StreamMessage.SIGNATURE_TYPES.ETH)
                    expect(streamMessage.getPublisherId())
                    expect(streamMessage.signature)
                }))

                // publisher.once('error', done.reject)
                await publisher.setNextGroupKey(stream.id, groupKey)
                // Publish after subscribed
                await Promise.all([
                    publisher.publish(stream.id, msg),
                    done,
                ])
            })

            it('client.subscribe can get the group key and decrypt encrypted message using an RSA key pair', async () => {
                const done = Defer()
                const msg = Msg()
                const groupKey = GroupKey.generate()
                // subscribe without knowing the group key to decrypt stream messages
                await subscriber.subscribe({
                    stream: stream.id,
                }, done.wrap((parsedContent, streamMessage) => {
                    expect(parsedContent).toEqual(msg)

                    // Check signature stuff
                    expect(streamMessage.signatureType).toBe(StreamMessage.SIGNATURE_TYPES.ETH)
                    expect(streamMessage.getPublisherId())
                    expect(streamMessage.signature)
                }))

                await publisher.setNextGroupKey(stream.id, groupKey)
                const onEncryptionMessageErr = checkEncryptionMessages(publisher)

                await Promise.all([
                    publisher.publish(stream.id, msg),
                    done,
                ])
                onEncryptionMessageErr.resolve(undefined)
                await onEncryptionMessageErr
            }, TIMEOUT * 2)

            it('allows other users to get group key', async () => {
                const onEncryptionMessageErr = checkEncryptionMessages(publisher)
                const onEncryptionMessageErr2 = checkEncryptionMessages(subscriber)
                const done = Defer()
                const msg = Msg()
                // subscribe without knowing the group key to decrypt stream messages
                await subscriber.subscribe({
                    stream: stream.id,
                }, done.wrap((parsedContent, streamMessage) => {
                    expect(parsedContent).toEqual(msg)

                    // Check signature stuff
                    expect(streamMessage.signatureType).toBe(StreamMessage.SIGNATURE_TYPES.ETH)
                    expect(streamMessage.getPublisherId())
                    expect(streamMessage.signature)
                }))
                // sub.once('error', done.reject)

                const groupKey = GroupKey.generate()
                await publisher.setNextGroupKey(stream.id, groupKey)

                await Promise.all([
                    publisher.publish(stream.id, msg),
                    done,
                ])
                onEncryptionMessageErr.resolve(undefined)
                await onEncryptionMessageErr
                onEncryptionMessageErr2.resolve(undefined)
                await onEncryptionMessageErr2
            }, TIMEOUT * 2)

            it('changing group key injects group key into next stream message', async () => {
                const done = Defer()
                const msgs = [Msg(), Msg(), Msg()]
                const received: any[] = []
                // subscribe without knowing the group key to decrypt stream messages
                await subscriber.subscribe({
                    stream: stream.id,
                }, done.wrapError((_parsedContent, streamMessage) => {
                    // Check signature stuff
                    received.push(streamMessage)
                    if (received.length === msgs.length) {
                        done.resolve(undefined)
                    }
                }))

                const onEncryptionMessageErr = checkEncryptionMessages(publisher)
                // id | groupKeyId | newGroupKey (encrypted by groupKeyId)
                // msg1 gk2 -
                // msg2 gk2 gk3
                // msg3 gk3 -
                const groupKey1 = GroupKey.generate()
                const groupKey2 = GroupKey.generate()
                await publisher.setNextGroupKey(stream.id, groupKey1)
                await publisher.publish(stream.id, msgs[0])
                await publisher.setNextGroupKey(stream.id, groupKey2)
                await publisher.publish(stream.id, msgs[1])
                await publisher.publish(stream.id, msgs[2])
                await done
                onEncryptionMessageErr.resolve(undefined)
                expect(received.map((m) => m.getParsedContent())).toEqual(msgs)
                received.forEach((streamMessage, index) => {
                    expect(streamMessage.signatureType).toBe(StreamMessage.SIGNATURE_TYPES.ETH)
                    expect(streamMessage.getPublisherId())
                    expect(streamMessage.signature)
                    switch (index) {
                        case 0: {
                            expect(streamMessage.newGroupKey).toEqual(null)
                            expect(streamMessage.groupKeyId).toEqual(groupKey1.id)
                            break
                        }
                        case 1: {
                            expect(streamMessage.newGroupKey).toEqual(groupKey2)
                            expect(streamMessage.groupKeyId).toEqual(groupKey1.id)
                            break
                        }
                        case 2: {
                            expect(streamMessage.newGroupKey).toEqual(null)
                            expect(streamMessage.groupKeyId).toEqual(groupKey2.id)
                            break
                        }
                        default: {
                            throw new Error(`should not get here: ${index}`)
                        }
                    }
                })

                await onEncryptionMessageErr
            }, TIMEOUT * 2)

            it('does not encrypt messages in stream without groupkey', async () => {
                const stream2 = await createTestStream(publisher, module, {
                    requireEncryptedData: false,
                })

                let didFindStream2 = false

                function checkEncryptionMessagesPerStream(testClient: BrubeckClient) {
                    const onSendTest = Defer()
                    testClient.publisher.publishQueue.forEach(onSendTest.wrapError(async ([streamMessage]) => {
                        // check encryption is as expected
                        if (streamMessage.getStreamId() === stream2.id) {
                            didFindStream2 = true
                            // stream2 always unencrypted
                            expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.NONE)
                            return
                        }

                        if (streamMessage.messageType === StreamMessage.MESSAGE_TYPES.MESSAGE) {
                            expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.AES)
                        } else if (streamMessage.messageType === StreamMessage.MESSAGE_TYPES.GROUP_KEY_RESPONSE) {
                            expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.RSA)
                        } else {
                            expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.NONE)
                        }
                    })).onFinally(() => {
                        onSendTest.resolve(undefined)
                    })

                    return onSendTest
                }

                async function testSub(testStream: Stream) {
                    const done = Defer()
                    const received: any = []
                    await grantSubscriberPermissions({ stream: testStream })
                    await subscriber.subscribe({
                        stream: testStream.id,
                    }, done.wrapError((parsedContent) => {
                        received.push(parsedContent)
                        if (received.length === NUM_MESSAGES) {
                            done.resolve(undefined)
                        }
                    }))

                    const published: any[] = []
                    publisher.publisher.streamMessageQueue.onMessage(async ([streamMessage]) => {
                        if (!streamMessage.spid.matches(testStream.id)) { return }
                        published.push(streamMessage.getParsedContent())
                    })
                    await getPublishTestStreamMessages(publisher, testStream)(NUM_MESSAGES)

                    await done

                    expect(received).toEqual(published)
                }

                const onEncryptionMessageErr = checkEncryptionMessagesPerStream(publisher)

                const groupKey = GroupKey.generate()
                await publisher.setNextGroupKey(stream.id, groupKey)

                const tasks = [
                    testSub(stream),
                    testSub(stream2),
                ]
                await Promise.allSettled(tasks)
                await Promise.all(tasks)
                onEncryptionMessageErr.resolve(undefined)
                await onEncryptionMessageErr
                expect(didFindStream2).toBeTruthy()
            }, TIMEOUT * 2)

            it('client.subscribe can get the group key and decrypt multiple encrypted messages using an RSA key pair', async () => {
                // subscribe without knowing publisher the group key to decrypt stream messages
                const sub = await subscriber.subscribe({
                    stream: stream.id,
                })

                const groupKey = GroupKey.generate()
                await publisher.setNextGroupKey(stream.id, groupKey)

                const published: any[] = []
                publisher.publisher.streamMessageQueue.onMessage(async ([streamMessage]) => {
                    if (!streamMessage.spid.matches(stream.id)) { return }
                    published.push(streamMessage.getParsedContent())
                })
                await getPublishTestStreamMessages(publisher, stream)(NUM_MESSAGES)

                const received = []
                for await (const msg of sub) {
                    received.push(msg.getParsedContent())
                    if (received.length === NUM_MESSAGES) {
                        break
                    }
                }

                expect(received).toEqual(published)
                expect(received).toHaveLength(NUM_MESSAGES)
            }, TIMEOUT * 2)

            it('subscribe with rotating group key', async () => {
                // subscribe without knowing the group key to decrypt stream messages
                const sub = await subscriber.subscribe({
                    stream: stream.id,
                })

                await publisher.rotateGroupKey(stream.id)
                const publishedStreamMessages: any[] = []
                publisher.publisher.streamMessageQueue.onMessage(async ([streamMessage]) => {
                    if (!streamMessage.spid.matches(stream.id)) { return }
                    publishedStreamMessages.push(streamMessage.clone())
                    await publisher.rotateGroupKey(stream.id)
                })
                const published = await getPublishTestStreamMessages(publisher, stream)(NUM_MESSAGES)

                // published with encryption
                expect(published.map((s) => s.encryptionType)).toEqual(published.map(() => StreamMessage.ENCRYPTION_TYPES.AES))

                const received = await sub.collect(published.length)
                expect(received.map((s) => s.getParsedContent())).toEqual(publishedStreamMessages.map((s) => s.getParsedContent()))
                expect(received).toHaveLength(NUM_MESSAGES)
            }, TIMEOUT * 2)

            it('can rotate when publisher + subscriber initialised with groupkey', async () => {
                await publisher.destroy()
                await subscriber.destroy()

                const groupKey = GroupKey.generate()
                const groupKeys = {
                    [stream.id]: {
                        [groupKey.id]: {
                            groupKeyId: groupKey.id,
                            groupKeyHex: groupKey.hex,
                        }
                    }
                }

                // eslint-disable-next-line require-atomic-updates
                publisher = await setupClient({
                    auth: publisher.options.auth,
                    groupKeys,
                })

                // eslint-disable-next-line require-atomic-updates
                subscriber = await setupClient({
                    auth: subscriber.options.auth,
                    groupKeys,
                })

                const contentClear: any[] = []
                const streamMessagesPublished: StreamMessage<any>[] = []
                publisher.publisher.streamMessageQueue.forEach(([streamMessage]) => {
                    if (!streamMessage.spid.matches(stream.id)) { return }
                    contentClear.push(streamMessage.getParsedContent())
                })
                publisher.publisher.publishQueue.forEach(([streamMessage]) => {
                    if (!streamMessage.spid.matches(stream.id)) { return }
                    streamMessagesPublished.push(streamMessage)
                })

                const publishStream = publishTestMessagesGenerator(publisher, stream, NUM_MESSAGES)
                await publisher.connect()
                await publisher.rotateGroupKey(stream.id)
                const sub = (await subscriber.subscribe({
                    stream: stream.id,
                }))
                await publishStream.collect(NUM_MESSAGES)

                // published with encryption
                expect(streamMessagesPublished.map((streamMessage) => streamMessage.encryptionType))
                    .toEqual(streamMessagesPublished.map(() => StreamMessage.ENCRYPTION_TYPES.AES))

                const received = await sub.collect(NUM_MESSAGES)

                expect(received.map((s) => s.getParsedContent())).toEqual(contentClear)
            }, TIMEOUT * 2)

            it('client.resend last can get the historical keys for previous encrypted messages', async () => {
                // Publish encrypted messages with different keys
                await publisher.rotateGroupKey(stream.id)
                publisher.publisher.streamMessageQueue.forEach(async () => {
                    await publisher.rotateGroupKey(stream.id)
                })
                const published: any[] = []
                publisher.publisher.streamMessageQueue.forEach(([streamMessage]) => {
                    if (!streamMessage.spid.matches(stream.id)) { return }
                    published.push(streamMessage.getParsedContent())
                })
                await publishTestMessages(NUM_MESSAGES, {
                    waitForLast: true,
                })

                // resend without knowing the historical keys
                await grantSubscriberPermissions()
                const sub = await subscriber.resend({
                    streamId: stream.id,
                    resend: {
                        last: 2,
                    },
                })

                const received = await sub.collect()

                expect(received.map((s) => s.getParsedContent())).toEqual(published.slice(-2))
            }, TIMEOUT * 2)
            /*
               it.skip('client.subscribe with resend last can get the historical keys for previous encrypted messages', async () => {
            // Publish encrypted messages with different keys
            await publisher.rotateGroupKey(stream.id)
            publisher.publisher.publishQueue.forEach(async () => {
            await publisher.rotateGroupKey(stream.id)
            })
            const published = await publishTestMessages(5, {
waitForLast: true,
})

await grantSubscriberPermissions()
// subscribe with resend without knowing the historical keys
const sub = await subscriber.subscribe({
stream: stream.id,
resend: {
last: 2,
},
})

const received = []
for await (const msg of sub) {
received.push(msg.getParsedContent())
if (received.length === 2) {
break
}
}

expect(received).toEqual(published.slice(-2))
await subscriber.unsubscribe(sub)
}, TIMEOUT * 2)
             */

            describe('error handling', () => {
                let sub: Subscription<any>
                const MAX_MESSAGES_MORE = 10
                const BAD_INDEX = 6
                let contentClear: any[] = []

                beforeEach(async () => {
                    const groupKey = GroupKey.generate()
                    const keys = {
                        [stream.id]: {
                            [groupKey.id]: groupKey,
                        }
                    }

                    await publisher.setNextGroupKey(stream.id, groupKey)
                    contentClear = []

                    publisher.publisher.streamMessageQueue.forEach(([streamMessage]) => {
                        if (!streamMessage.spid.matches(stream.id)) { return }
                        contentClear.push(streamMessage.getParsedContent())
                    })

                    publisher.publisher.publishQueue.forEach(async () => {
                        await publisher.rotateGroupKey(stream.id)
                    })

                    sub = await subscriber.subscribe({
                        stream: stream.id,
                        // @ts-expect-error
                        groupKeys: keys,
                    })
                    const subSession = subscriber.getSubscriptionSession(sub)
                    if (!subSession) { throw new Error('no subsession?') }
                    subSession.pipeline.forEachBefore((streamMessage, index) => {
                        if (index === BAD_INDEX) {
                            // eslint-disable-next-line no-param-reassign
                            streamMessage.groupKeyId = 'badgroupkey'
                        }
                    })
                })

                it('ignores message if onError does not rethrow', async () => {
                    const onSubError = jest.fn()
                    sub.onError(onSubError)
                    // Publish after subscribed
                    await publishTestMessages(MAX_MESSAGES_MORE, {
                        timestamp: 1111111,
                    })

                    const received: any[] = []
                    for await (const m of sub) {
                        received.push(m.getParsedContent())
                        if (received.length === MAX_MESSAGES_MORE - 1) {
                            break
                        }
                    }

                    expect(received).toEqual([
                        ...contentClear.slice(0, BAD_INDEX),
                        ...contentClear.slice(BAD_INDEX + 1, MAX_MESSAGES_MORE)
                    ])

                    expect(subscriber.getAllSubscriptions()).toHaveLength(0)
                    expect(onSubError).toHaveBeenCalledTimes(1)
                })

                it('throws if onError does rethrow', async () => {
                    const onSubError = jest.fn((err) => {
                        throw err
                    })
                    sub.onError(onSubError)
                    // Publish after subscribed
                    await publishTestMessages(MAX_MESSAGES_MORE, {
                        timestamp: 1111111,
                    })

                    const received: any[] = []
                    await expect(async () => {
                        for await (const m of sub) {
                            received.push(m.getParsedContent())
                            if (received.length === MAX_MESSAGES_MORE - 1) {
                                break
                            }
                        }
                    }).rejects.toThrow('decrypt')

                    expect(received).toEqual([
                        ...contentClear.slice(0, BAD_INDEX),
                    ])
                    expect(subscriber.getAllSubscriptions()).toHaveLength(0)

                    expect(onSubError).toHaveBeenCalledTimes(1)
                })
            })
        })

        it('errors if rotating group key for no stream', async () => {
            await expect(async () => (
                // @ts-expect-error
                publisher.rotateGroupKey()
            )).rejects.toThrow('streamId')
        })

        it('errors if setting group key for no stream', async () => {
            await expect(async () => {
                // @ts-expect-error
                await publisher.setNextGroupKey(undefined, GroupKey.generate())
            }).rejects.toThrow('streamId')
        })

        it('does encrypt messages in stream that does not require encryption but groupkey is set anyway', async () => {
            const stream2 = await createTestStream(publisher, module, {
                requireEncryptedData: false,
            })

            let didFindStream2 = false

            function checkEncryptionMessagesPerStream(testClient: BrubeckClient) {
                const onSendTest = Defer()
                testClient.publisher.publishQueue.forEach(onSendTest.wrapError(async ([streamMessage]) => {
                    if (streamMessage.getStreamId() === stream2.id) {
                        didFindStream2 = true
                        testClient.debug('streamMessage.encryptionType', streamMessage.encryptionType, StreamMessage.ENCRYPTION_TYPES.AES)
                        expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.AES)
                    }
                })).onFinally(() => {
                    onSendTest.resolve(undefined)
                })

                return onSendTest
            }

            async function testSub(testStream: Stream) {
                const done = Defer()
                const received: any = []
                await grantSubscriberPermissions({ stream: testStream })
                await subscriber.subscribe({
                    streamId: testStream.id,
                }, done.wrapError((parsedContent) => {
                    received.push(parsedContent)
                    if (received.length === NUM_MESSAGES) {
                        done.resolve(undefined)
                    }
                }))

                await publisher.rotateGroupKey(testStream.id)
                const published: any[] = []
                publisher.publisher.streamMessageQueue.onMessage(async ([streamMessage]) => {
                    if (!streamMessage.spid.matches(testStream.id)) { return }
                    published.push(streamMessage.getParsedContent())
                    await publisher.rotateGroupKey(testStream.id)
                })

                await getPublishTestStreamMessages(publisher, testStream)(NUM_MESSAGES)

                await done

                expect(received).toEqual(published)
            }

            const onEncryptionMessageErr = checkEncryptionMessagesPerStream(publisher)

            const groupKey = GroupKey.generate()
            await publisher.setNextGroupKey(stream.id, groupKey)

            await Promise.all([
                testSub(stream),
                testSub(stream2),
            ])
            onEncryptionMessageErr.resolve(undefined)
            await onEncryptionMessageErr
            expect(didFindStream2).toBeTruthy()
        }, TIMEOUT * 2)

        it('sets group key per-stream', async () => {
            const stream2 = await createTestStream(publisher, module, {
                requireEncryptedData: false,
            })

            function checkEncryptionMessagesPerStream(testClient: BrubeckClient) {
                const onSendTest = Defer()
                testClient.publisher.publishQueue.forEach(onSendTest.wrapError(async ([streamMessage]) => {
                    testClient.debug({ streamMessage })

                    if (streamMessage.getStreamId() === stream2.id) {
                        expect(streamMessage.groupKeyId).toEqual(groupKey2.id)
                    }

                    if (streamMessage.getStreamId() === stream.id) {
                        expect(streamMessage.groupKeyId).toEqual(groupKey.id)
                    }

                    if (streamMessage.messageType === StreamMessage.MESSAGE_TYPES.MESSAGE) {
                        expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.AES)
                    } else if (streamMessage.messageType === StreamMessage.MESSAGE_TYPES.GROUP_KEY_RESPONSE) {
                        expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.RSA)
                    } else {
                        expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.NONE)
                    }
                })).onFinally(() => {
                    onSendTest.resolve(undefined)
                })

                return onSendTest
            }

            async function testSub(testStream: Stream) {
                const done = Defer()
                const received: any = []
                await grantSubscriberPermissions({ stream: testStream })
                await subscriber.subscribe({
                    streamId: testStream.id,
                }, done.wrapError((parsedContent) => {
                    received.push(parsedContent)
                    if (received.length === NUM_MESSAGES) {
                        done.resolve(undefined)
                    }
                }))

                const contentClear: any[] = []
                publisher.publisher.streamMessageQueue.onMessage(([streamMessage]) => {
                    if (!streamMessage.spid.matches(testStream.id)) { return }
                    contentClear.push(streamMessage.getParsedContent())
                })
                await getPublishTestStreamMessages(publisher, testStream)(NUM_MESSAGES)

                await done

                expect(received).toEqual(contentClear)
            }

            const onEncryptionMessageErr = checkEncryptionMessagesPerStream(publisher)

            const groupKey = GroupKey.generate()
            await publisher.setNextGroupKey(stream.id, groupKey)
            const groupKey2 = GroupKey.generate()
            await publisher.setNextGroupKey(stream2.id, groupKey2)

            const tasks = [
                testSub(stream),
                testSub(stream2)
            ]
            await Promise.allSettled(tasks)
            await Promise.all(tasks)
            onEncryptionMessageErr.resolve(undefined)
            await onEncryptionMessageErr
        }, TIMEOUT * 2)
    })
    /*
    describe('revoking permissions', () => {
        async function testRevokeDuringSubscribe({
            maxMessages = 6,
            revokeAfter = Math.round(maxMessages / 2),
        }: {
            maxMessages?: number
            revokeAfter?: number
        } = {}) {
            // this has publisher & subscriber clients
            // publisher begins publishing `maxMessages` messages
            // subscriber recieves messages
            // after publisher publishes `revokeAfter` messages,
            // and subscriber receives the last message
            // subscriber has subscribe permission removed
            // and publisher rekeys the stream.
            // Publisher then keep publishing messages with the new key.
            // The subscriber should error on the next message, and unsubscribe
            // due to permission change.
            // check that subscriber only got messages from before permission revoked
            // and subscriber errored with something about group key or
            // permissions

            await publisher.rotateGroupKey(stream.id)

            await stream.grantPermission(StreamOperation.STREAM_GET, await subscriber.getPublisherId())
            const subPermission = await stream.grantPermission(StreamOperation.STREAM_SUBSCRIBE, await subscriber.getPublisherId())

            const sub = await subscriber.subscribe({
                stream: stream.id,
            })

            const errs: Error[] = []
            const onSubError = jest.fn((err: Error) => {
                errs.push(err)
                throw err // this should trigger unsub
            })

            sub.on('error', onSubError)

            const received: any[] = []
            // Publish after subscribed
            let count = 0
            const gotMessages = Defer()
            // do publish in background otherwise permission is revoked before subscriber starts processing
            const publishTask = publishTestMessages(maxMessages, {
                timestamp: 1111111,
                async afterEach() {
                    count += 1
                    publisher.debug('PUBLISHED %d of %d', count, maxMessages)
                    if (count === revokeAfter) {
                        await gotMessages
                        await stream.revokePermission(subPermission.id)
                        await publisher.rekey(stream.id)
                    }
                }
            })

            subscriber.debug('\n\n1\n\n')
            let t!: ReturnType<typeof setTimeout>
            const timedOut = jest.fn()
            try {
                await expect(async () => {
                    for await (const m of sub) {
                        subscriber.debug('got', m.getParsedContent())
                        received.push(m.getParsedContent())
                        if (received.length === revokeAfter) {
                            gotMessages.resolve(undefined)
                            clearTimeout(t)
                            t = setTimeout(() => {
                                timedOut()
                                sub.cancel()
                            }, 6000)
                        }

                        if (received.length === maxMessages) {
                            clearTimeout(t)
                            break
                        }
                    }
                }).rejects.toThrow(/not a subscriber|Could not get GroupKey/)
            } finally {
                clearTimeout(t)
                // run in finally to ensure publish promise finishes before
                // continuing no matter the result of the expect call above
                const published = await publishTask

                expect(received).toEqual([
                    ...published.slice(0, revokeAfter),
                ])

                expect(onSubError).toHaveBeenCalledTimes(1)
                expect(timedOut).toHaveBeenCalledTimes(0)
            }
        }

        describe('low cache maxAge', () => {
            beforeEach(async () => {
                await setupPublisherSubscriberClients({
                    cache: {
                        maxAge: 1,
                    }
                })
            })
            beforeEach(async () => {
                await setupStream()
            })
            it('fails gracefully if permission revoked after first message', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 6, revokeAfter: 1 })
            })
            it('fails gracefully if permission revoked after some messages', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 6, revokeAfter: 3 })
            })
        })

        describe('high cache maxAge', () => {
            beforeEach(async () => {
                await setupPublisherSubscriberClients({
                    cache: {
                        maxAge: 9999999,
                    }
                })
            })

            beforeEach(async () => {
                await setupStream()
            })

            it('fails gracefully if permission revoked after first message', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 6, revokeAfter: 1 })
            })

            it('fails gracefully if permission revoked after some messages', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 6, revokeAfter: 3 })
            })
        })
    })
    */
})
