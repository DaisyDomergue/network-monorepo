import fetch from 'node-fetch'
import { StreamMetadata } from 'streamr-client-protocol/dist/src/utils/StreamMessageValidator'
import { SPID, SID, MessageContent } from 'streamr-client-protocol'
import { DependencyContainer, inject } from 'tsyringe'

export { GroupKey } from './encryption/Encryption'
import { StorageNode } from './StorageNode'
import { EthereumAddress } from './types'
import { until } from './utils'

import { Rest } from './Rest'
import Resends from './Resends'
import Publisher from './Publisher'
import { BrubeckContainer } from './Container'
import { BigNumber } from '@ethersproject/bignumber'

// TODO explicit types: e.g. we never provide both streamId and id, or both streamPartition and partition
export type StreamPartDefinitionOptions = {
    streamId?: string,
    streamPartition?: number,
    id?: string,
    partition?: number,
    stream?: StreamrStream|string
}

export type StreamPartDefinition = string | StreamPartDefinitionOptions

export type ValidatedStreamPartDefinition = { streamId: string, streamPartition: number, key: string}

export interface StreamPermission {
    streamId: string
    userAddress: string
    edit: boolean
    canDelete: boolean
    publishExpiration: BigNumber
    subscribeExpiration: BigNumber
    share: boolean
}

export enum StreamOperation {
    // STREAM_GET = 'stream_get',
    STREAM_EDIT = 'edit',
    STREAM_DELETE = 'canDelete',
    STREAM_PUBLISH = 'publishExpiration',
    STREAM_SUBSCRIBE = 'subscribeExpiration',
    STREAM_SHARE = 'share'
}

export interface StreamProperties {
    id: string
    name?: string
    description?: string
    config?: {
        fields: Field[];
    }
    partitions?: number
    requireSignedData?: boolean
    requireEncryptedData?: boolean
    storageDays?: number
    inactivityThresholdHours?: number
}

const VALID_FIELD_TYPES = ['number', 'string', 'boolean', 'list', 'map'] as const

export type Field = {
    name: string;
    type: typeof VALID_FIELD_TYPES[number];
}

function getFieldType(value: any): (Field['type'] | undefined) {
    const type = typeof value
    switch (true) {
        case Array.isArray(value): {
            return 'list'
        }
        case type === 'object': {
            return 'map'
        }
        case (VALID_FIELD_TYPES as ReadonlyArray<string>).includes(type): {
            // see https://github.com/microsoft/TypeScript/issues/36275
            return type as Field['type']
        }
        default: {
            return undefined
        }
    }
}

class StreamrStream implements StreamMetadata {
    streamId: string
    id: string
    // @ts-expect-error
    name: string
    description?: string
    config: {
        fields: Field[];
    } = { fields: [] }
    partitions!: number
    /** @internal */
    requireEncryptedData!: boolean
    requireSignedData!: boolean
    storageDays?: number
    inactivityThresholdHours?: number
    _rest: Rest
    _resends: Resends
    _publisher: Publisher

    constructor(props: StreamProperties, @inject(BrubeckContainer) private container: DependencyContainer) {
        Object.assign(this, props)
        this.id = props.id
        this.streamId = this.id
        this._rest = container.resolve<Rest>(Rest)
        this._resends = container.resolve<Resends>(Resends)
        this._publisher = container.resolve<Publisher>(Publisher)
    }

    async update() {
        const json = await this._rest.put<StreamProperties>(
            ['streams', this.id],
            this.toObject(),
        )
        return json ? new StreamrStream(json, this.container) : undefined
    }

    toObject() {
        const result = {}
        Object.keys(this).forEach((key) => {
            if (!key.startsWith('_')) {
                // @ts-expect-error
                result[key] = this[key]
            }
        })
        return result
    }

    async delete() {
        await this._rest.del(
            ['streams', this.id],
        )
    }

    async getPermissions() {
        return this.getAllPermissionsForStream(this.id)
    }

    async getMyPermissions() {
        return this._client.getPermissionsForUser(this.id, await this._client.getAddress())
    }

    async hasPermission(operation: StreamOperation, userId: EthereumAddress) {
        // eth addresses may be in checksumcase, but userId from server has no case

        // const userIdCaseInsensitive = typeof userId === 'string' ? userId.toLowerCase() : undefined // if not string then undefined
        const permissions = await this._client.getPermissionsForUser(this.id, userId)

        if (operation === StreamOperation.STREAM_PUBLISH || operation === StreamOperation.STREAM_SUBSCRIBE) {
            return permissions[operation].gt(Date.now())
        }
        return permissions[operation]
    }

    async grantPermission(operation: StreamOperation, recipientId: EthereumAddress) {
        await this._client.grantPermission(this.id, operation, recipientId.toLowerCase())
    }

    async grantPublicPermission(operation: StreamOperation) {
        await this._client.grantPublicPermission(this.id, operation)
    }

    async revokePermission(operation: StreamOperation, recipientId: EthereumAddress) {
        await this._client.revokePermission(this.id, operation, recipientId.toLowerCase())
    }

    async revokePublicPermission(operation: StreamOperation) {
        await this._client.revokePublicPermission(this.id, operation)
    }

    async addToStorageNode(node: StorageNode | EthereumAddress) {
        // @ts-ignore
        await this._client.addStreamToStorageNode(this.id, node.address || node)
    }

    async removeFromStorageNode(node: StorageNode | EthereumAddress) {
        // @ts-ignore
        return this._client.removeStreamFromStorageNode(this.id, node.address || node)
    }

    private async isStreamStoredInStorageNode(node: StorageNode | EthereumAddress) {
        // @ts-ignore
        return this._client.isStreamStoredInStorageNode(this.id, node.address || node)
    }

    async getStorageNodes() {
        return this._client.getAllStorageNodes()
    }

    async publish<T extends MessageContent>(content: T, timestamp?: number|string|Date, partitionKey?: string) {
        return this._publisher.publish(this.id, content, timestamp, partitionKey)
    }
}

export {
    StreamrStream as Stream
}
