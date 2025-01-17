import crypto from 'crypto'
import { ValidationError } from 'streamr-client-protocol'
import { uuid } from '../utils'
import { inspect } from '../utils/log'

class InvalidGroupKeyError extends ValidationError {
    constructor(message: string, public groupKey?: any) {
        super(message)
    }
}

export type GroupKeyObject = {
    id: string,
    hex: string,
    data: Uint8Array,
}

type GroupKeyProps = {
    groupKeyId: string,
    groupKeyHex: string,
    groupKeyData: Uint8Array,
}

function GroupKeyObjectFromProps(data: GroupKeyProps | GroupKeyObject) {
    if ('groupKeyId' in data) {
        return {
            id: data.groupKeyId,
            hex: data.groupKeyHex,
            data: data.groupKeyData,
        }
    }

    return data
}

export type GroupKeyish = GroupKey | GroupKeyObject | ConstructorParameters<typeof GroupKey>

// eslint-disable-next-line no-redeclare
export class GroupKey {
    /** @internal */
    static InvalidGroupKeyError = InvalidGroupKeyError

    static validate(maybeGroupKey: GroupKey) {
        if (!maybeGroupKey) {
            throw new InvalidGroupKeyError(`value must be a ${this.name}: ${inspect(maybeGroupKey)}`, maybeGroupKey)
        }

        if (!(maybeGroupKey instanceof this)) {
            throw new InvalidGroupKeyError(`value must be a ${this.name}: ${inspect(maybeGroupKey)}`, maybeGroupKey)
        }

        if (!maybeGroupKey.id || typeof maybeGroupKey.id !== 'string') {
            throw new InvalidGroupKeyError(`${this.name} id must be a string: ${inspect(maybeGroupKey)}`, maybeGroupKey)
        }

        if (maybeGroupKey.id.includes('---BEGIN')) {
            throw new InvalidGroupKeyError(
                `${this.name} public/private key is not a valid group key id: ${inspect(maybeGroupKey)}`,
                maybeGroupKey
            )
        }

        if (!maybeGroupKey.data || !Buffer.isBuffer(maybeGroupKey.data)) {
            throw new InvalidGroupKeyError(`${this.name} data must be a Buffer: ${inspect(maybeGroupKey)}`, maybeGroupKey)
        }

        if (!maybeGroupKey.hex || typeof maybeGroupKey.hex !== 'string') {
            throw new InvalidGroupKeyError(`${this.name} hex must be a string: ${inspect(maybeGroupKey)}`, maybeGroupKey)
        }

        if (maybeGroupKey.data.length !== 32) {
            throw new InvalidGroupKeyError(`Group key must have a size of 256 bits, not ${maybeGroupKey.data.length * 8}`, maybeGroupKey)
        }

    }

    id: string
    hex: string
    data: Uint8Array

    constructor(groupKeyId: string, groupKeyBufferOrHexString: Uint8Array | string) {
        this.id = groupKeyId
        if (!groupKeyId) {
            throw new InvalidGroupKeyError(`groupKeyId must not be falsey ${inspect(groupKeyId)}`)
        }

        if (!groupKeyBufferOrHexString) {
            throw new InvalidGroupKeyError(`groupKeyBufferOrHexString must not be falsey ${inspect(groupKeyBufferOrHexString)}`)
        }

        if (typeof groupKeyBufferOrHexString === 'string') {
            this.hex = groupKeyBufferOrHexString
            this.data = Buffer.from(this.hex, 'hex')
        } else {
            this.data = groupKeyBufferOrHexString
            this.hex = Buffer.from(this.data).toString('hex')
        }

        (this.constructor as typeof GroupKey).validate(this)
    }

    equals(other: GroupKey) {
        if (!(other instanceof GroupKey)) {
            return false
        }

        return this === other || (this.hex === other.hex && this.id === other.id)
    }

    toString() {
        return this.id
    }

    toArray() {
        return [this.id, this.hex]
    }

    serialize() {
        return JSON.stringify(this.toArray())
    }

    static generate(id = uuid('GroupKey')) {
        const keyBytes = crypto.randomBytes(32)
        return new GroupKey(id, keyBytes)
    }

    static from(maybeGroupKey: GroupKeyish) {
        if (!maybeGroupKey || typeof maybeGroupKey !== 'object') {
            throw new InvalidGroupKeyError('Group key must be object', maybeGroupKey)
        }

        if (maybeGroupKey instanceof GroupKey) {
            return maybeGroupKey
        }

        try {
            if (Array.isArray(maybeGroupKey)) {
                return new GroupKey(maybeGroupKey[0], maybeGroupKey[1])
            }

            const groupKeyObj = GroupKeyObjectFromProps(maybeGroupKey)
            return new GroupKey(groupKeyObj.id, groupKeyObj.hex || groupKeyObj.data)
        } catch (err) {
            if (err instanceof InvalidGroupKeyError) {
                // wrap err with logging of original object
                throw new InvalidGroupKeyError(`${err.stack}:`, maybeGroupKey)
            }
            throw err
        }
    }
}
