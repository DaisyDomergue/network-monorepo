import { Gate, instanceId } from './index'
import { Debug } from './log'
import { Context, ContextError } from './Context'

export class PushBufferError extends ContextError {}

export const DEFAULT_BUFFER_SIZE = 256

function isError(err: any): err is Error {
    if (!err) { return false }

    if (err instanceof Error) { return true }

    return !!(
        err
        && err.stack
        && err.message
        && typeof err.stack === 'string'
        && typeof err.message === 'string'
    )
}

export type IPushBuffer<InType, OutType = InType> = {
    push(item: InType): Promise<boolean>
    end(error?: Error): void
    endWrite(error?: Error): void
    length: number
    isFull(): boolean
    isDone(): boolean
} & Context & AsyncGenerator<OutType>

/**
 * Implements an async buffer.
 * Push items into buffer, push will async block once buffer is full.
 * and will unblock once buffer has been consumed.
 */
export class PushBuffer<T> implements IPushBuffer<T> {
    readonly id
    readonly debug

    protected readonly buffer: (T | Error)[] = []
    readonly bufferSize: number

    /** open when writable */
    protected readonly writeGate: Gate
    /** open when readable */
    protected readonly readGate: Gate
    protected done = false
    protected error: Error | undefined
    protected iterator: AsyncGenerator<T>
    protected isIterating = false

    constructor(bufferSize = DEFAULT_BUFFER_SIZE, { name }: Partial<{ name: string }> = {}) {
        this.id = instanceId(this, name)
        this.bufferSize = bufferSize
        // start both closed
        this.writeGate = new Gate(`${this.id}-write`)
        this.readGate = new Gate(`${this.id}-read`)
        this.writeGate.close()
        this.readGate.close()
        this.debug = Debug(this.id)
        this.iterator = this.iterate()
        // this.debug('create', this.bufferSize)
    }

    /**
     * Puts item in buffer and opens readGate.
     * Blocks until writeGate is open again (or locked)
     * @returns Promise<true> if item was pushed, Promise<false> if done or became done before writeGate opened.
     */
    async push(item: T) {
        if (this.isDone() || this.writeGate.isLocked) {
            return false
        }

        this.buffer.push(item)
        this.updateWriteGate()
        this.readGate.open()
        const ok = await this.writeGate.check()
        return ok
    }

    /**
     * Collect n/all messages into an array.
     */
    async collect(n?: number) {
        if (this.isIterating) {
            throw new PushBufferError(this, 'Cannot collect if already iterating.')
        }

        const msgs = []
        for await (const msg of this) {
            if (n === 0) {
                break
            }

            msgs.push(msg)

            if (msgs.length === n) {
                break
            }
        }
        return msgs
    }

    private updateWriteGate() {
        this.writeGate.setOpenState(!this.isFull())
    }

    /**
     * Immediate end of reading and writing
     * Buffer will not flush.
     */
    end(err?: Error) {
        if (err) {
            this.error = err
        }
        this.readGate.lock()
        this.writeGate.lock()
    }

    /**
     * Prevent further writes.
     * Allows buffer to flush before ending.
     */
    endWrite(err?: Error) {
        if (err && !this.error) {
            this.error = err
        }

        this.readGate.open()
        this.writeGate.lock()
    }

    /**
     * True if buffered at least bufferSize items.
     * After this point, push will block until buffer is emptied again.
     */
    isFull() {
        return this.buffer.length >= this.bufferSize
    }

    /**
     * True if buffer has closed reads and writes.
     */

    isDone() {
        return this.writeGate.isLocked && this.readGate.isLocked
    }

    private async* iterate() {
        this.isIterating = true
        try {
            // if there's something buffered, we want to flush it
            while (!this.readGate.isLocked) {
                // keep reading off front of buffer until buffer empty
                while (this.buffer.length && !this.readGate.isLocked) {
                    const v = this.buffer.shift()!
                    // maybe open write gate
                    this.updateWriteGate()
                    if (isError(v)) {
                        throw v
                    }

                    yield v
                }
                if (this.buffer.length === 0 && this.writeGate.isLocked) {
                    break
                }

                if (this.isDone()) {
                    // buffer is empty and we're done
                    break
                }

                // buffer must be empty, close readGate until more writes.
                this.readGate.close()
                // wait for something to be written
                const ok = await this.readGate.check() // eslint-disable-line no-await-in-loop
                if (!ok) {
                    // no more reading
                    break
                }
            }

            const { error } = this
            if (error) {
                this.error = undefined
                throw error
            }
        } finally {
            this.buffer.length = 0
            this.writeGate.lock()
            this.readGate.lock()
        }
    }

    get length() {
        return this.buffer.length
    }

    // AsyncGenerator implementation

    async throw(err: Error) {
        this.endWrite(err)
        return this.iterator.throw(err)
    }

    async return(v?: T) {
        this.end()
        return this.iterator.return(v)
    }

    next() {
        return this.iterator.next()
    }

    [Symbol.asyncIterator]() {
        if (this.isIterating) {
            throw new PushBufferError(this, 'already iterating')
        }

        return this
    }
}

/**
 * Pull from a source into some PushBuffer
 */

export async function pull<InType, OutType = InType>(src: AsyncGenerator<InType>, dest: IPushBuffer<InType, OutType>) {
    if (!src) {
        throw new Error('no source')
    }

    try {
        for await (const v of src) {
            const ok = await dest.push(v)
            if (!ok) {
                break
            }
        }
    } catch (err) {
        dest.endWrite(err)
    } finally {
        dest.endWrite()
    }
}

/**
 * Pull from a source into self.
 */

export class PullBuffer<InType> extends PushBuffer<InType> {
    source: AsyncGenerator<InType>
    constructor(source: AsyncGenerator<InType>, ...args: ConstructorParameters<typeof PushBuffer>) {
        super(...args)
        this.source = source
        pull(this.source, this)
    }
}