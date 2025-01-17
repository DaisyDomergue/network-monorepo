/**
 * Cached Subset of StreamEndpoints.
 */
import { EthereumAddress, StreamID } from 'streamr-client-protocol'
import { Lifecycle, scoped, inject, delay } from 'tsyringe'
import { CacheAsyncFn, instanceId } from './utils'
import { Context } from './utils/Context'
import { CacheConfig, ConfigInjectionToken } from './Config'
import { StreamRegistry } from './StreamRegistry'
import { StreamPermission } from './permission'

const SEPARATOR = '|' // always use SEPARATOR for cache key

@scoped(Lifecycle.ContainerScoped)
export class StreamEndpointsCached implements Context {
    readonly id = instanceId(this)
    readonly debug

    constructor(
        context: Context,
        @inject(delay(() => StreamRegistry)) private streamRegistry: StreamRegistry,
        @inject(ConfigInjectionToken.Cache) private cacheOptions: CacheConfig
    ) {
        this.debug = context.debug.extend(this.id)
    }

    async getStreamPreloaded(streamId: StreamID) {
        return this.streamRegistry.getStream(streamId)
    }

    getStream = CacheAsyncFn(this.getStreamPreloaded.bind(this), {
        ...this.cacheOptions,
        cacheKey: ([streamId]: any) => {
            // see clearStream
            return `${streamId}${SEPARATOR}`
        }
    })

    async getStreamValidationInfoPreloaded(streamId: StreamID) {
        return this.streamRegistry.getStream(streamId)
    }

    getStreamValidationInfo = CacheAsyncFn(this.getStreamValidationInfoPreloaded.bind(this), {
        ...this.cacheOptions,
        cacheKey: ([streamId]: any) => {
            return `${streamId}${SEPARATOR}`
        }
    })

    async isStreamPublisherPreloaded(streamId: StreamID, ethAddress: EthereumAddress) {
        return this.streamRegistry.isStreamPublisher(streamId, ethAddress)
    }

    isStreamPublisher = CacheAsyncFn(this.isStreamPublisherPreloaded.bind(this), {
        ...this.cacheOptions,
        cacheKey([streamId, ethAddress]: any) {
            return [streamId, ethAddress.toLowerCase()].join(SEPARATOR)
        }
    })

    async isStreamSubscriberPreloaded(streamId: StreamID, ethAddress: EthereumAddress) {
        return this.streamRegistry.isStreamSubscriber(streamId, ethAddress)
    }

    isStreamSubscriber = CacheAsyncFn(this.isStreamSubscriberPreloaded.bind(this), {
        ...this.cacheOptions,
        cacheKey([streamId, ethAddress]: any) {
            return [streamId, ethAddress.toLowerCase()].join(SEPARATOR)
        }
    })

    async isPublicSubscriptionStream(streamId: StreamID) {
        return this.streamRegistry.hasPermission({
            streamId,
            public: true,
            permission: StreamPermission.SUBSCRIBE
        })
    }

    isPublic = CacheAsyncFn(this.isPublicSubscriptionStream.bind(this), {
        ...this.cacheOptions,
        cacheKey([streamId]): any {
            return ['PublicSubscribe', streamId].join(SEPARATOR)
        }
    })

    /**
     * Clear cache for streamId
     */
    clearStream(streamId: StreamID) {
        this.debug('clearStream', streamId)
        // include separator so startsWith(streamid) doesn't match streamid-something
        const target = `${streamId}${SEPARATOR}`
        const matchTarget = (s: string) => s.startsWith(target)
        this.getStream.clearMatching(matchTarget)
        this.getStreamValidationInfo.clearMatching(matchTarget)
        this.isStreamPublisher.clearMatching(matchTarget)
        this.isStreamSubscriber.clearMatching(matchTarget)
    }

    /**
     * Clear all cached data
     */
    clear() {
        this.debug('clear')
        this.getStream.clear()
        this.getStreamValidationInfo.clear()
        this.isStreamPublisher.clear()
        this.isStreamSubscriber.clear()
    }
}
