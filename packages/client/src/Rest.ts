import { Lifecycle, scoped, inject, DependencyContainer } from 'tsyringe'

import { Debugger } from './utils/log'
import { instanceId } from './utils'
import { ConnectionConfig, Config } from './Config'
import authFetch, { authRequest } from './authFetch'
import { Context } from './utils/Context'

import { BrubeckContainer } from './Container'

export type FetchOptions = {
    query?: any,
    useSession?: boolean,
    options?: any,
    requireNewToken?: boolean
    debug?: Debugger
}

export type UrlParts = (string | number)[]

function serialize(body: any): string | undefined {
    if (body == null) { return undefined }
    return typeof body === 'string' ? body : JSON.stringify(body)
}

@scoped(Lifecycle.ContainerScoped)
export class Rest implements Context {
    id
    debug
    constructor(
        context: Context,
        @inject(BrubeckContainer) private container: DependencyContainer,
        @inject(Config.Connection) private options: ConnectionConfig,
    ) {
        this.id = instanceId(this)
        this.debug = context.debug.extend(this.id)
    }

    getUrl(urlParts: UrlParts, query = {}) {
        const url = new URL(urlParts.map((s) => encodeURIComponent(s)).join('/'), this.options.restUrl + '/')
        const searchParams = new URLSearchParams(query)
        url.search = searchParams.toString()
        return url
    }


    fetch<T extends object>(baseUrl: string, urlParts: UrlParts, {
        query, useSession = true, options, requireNewToken = false, debug = this.debug
    }: FetchOptions) {
        const url = this.getUrl(urlParts, query)
        return authFetch<T>(
            url.toString(),
            options,
            requireNewToken,
            debug,
        )
    }

    request<T extends object>(urlParts: UrlParts, {
        query, useSession = true, options, requireNewToken = false, debug = this.debug
    }: FetchOptions) {
        const url = this.getUrl(urlParts, query)
        return authRequest<T>(
            url.toString(),
            options,
            requireNewToken,
            debug,
        )
    }

    post<T extends object>(baseUrl: string, urlParts: UrlParts, body?: any, options: FetchOptions = {}) {
        return this.fetch<T>(baseUrl, urlParts, {
            ...options,
            options: {
                ...options?.options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options?.options?.headers,
                },
                method: 'POST',
                body: serialize(body),
            }
        })
    }

    get<T extends object>(baseUrl: string, urlParts: UrlParts, options: FetchOptions = {}) {
        return this.fetch<T>(baseUrl, urlParts, {
            ...options,
            options: {
                ...options.options,
                method: 'GET',
            }
        })
    }

    put<T extends object>(baseUrl: string, urlParts: UrlParts, body?: any, options: FetchOptions = {}) {
        return this.fetch<T>(baseUrl, urlParts, {
            ...options,
            options: {
                ...options.options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options?.options?.headers,
                },
                method: 'PUT',
                body: serialize(body),
            }
        })
    }

    del<T extends object>(baseUrl: string, urlParts: UrlParts, options: FetchOptions = {}) {
        return this.fetch<T>(baseUrl, urlParts, {
            ...options,
            options: {
                ...options.options,
                method: 'DELETE',
            }
        })
    }

    async stream(urlParts: UrlParts, options: FetchOptions = {}, abortController = new AbortController()) {
        const startTime = Date.now()
        const response = await this.request(urlParts, {
            ...options,
            options: {
                signal: abortController.signal,
                ...options.options,
            }
        })

        const stream = response.body
        stream.once('close', () => {
            abortController.abort()
        })
        return Object.assign(stream, {
            startTime,
        })
    }
}
