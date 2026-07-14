const { ttlIndexArgs, ttlIndexArgsFromEnv, TTL_FIELD_PATH } = require('../ttl')
const { buildRecord } = require('../record')

describe('ttlIndexArgs', () => {
    it('builds createIndex(keys, options) for a TTL index on the given field', () => {
        const [keys, options] = ttlIndexArgs('payload._ts', 7776000)
        expect(keys).toEqual({ 'payload._ts': 1 })
        expect(options.expireAfterSeconds).toBe(7776000)
    })

    it('derives a legible, dot-free index name from the field path', () => {
        const [, options] = ttlIndexArgs('payload._ts', 7776000)
        // dots are illegal-ish in index names and hurt readability; flatten them
        expect(options.name).toBe('ttl_payload__ts')
    })
})

describe('ttlIndexArgsFromEnv', () => {
    it('returns index args targeting payload._ts when TTL_EXPIRE_SECONDS is set', () => {
        const [keys, options] = ttlIndexArgsFromEnv({ TTL_EXPIRE_SECONDS: '7776000' })
        expect(keys).toEqual({ 'payload._ts': 1 })
        expect(options.expireAfterSeconds).toBe(7776000)
    })

    it('returns null when TTL_EXPIRE_SECONDS is absent (no TTL for generic archives)', () => {
        expect(ttlIndexArgsFromEnv({})).toBeNull()
    })

    it('returns null when TTL_EXPIRE_SECONDS is not a positive integer', () => {
        expect(ttlIndexArgsFromEnv({ TTL_EXPIRE_SECONDS: 'abc' })).toBeNull()
        expect(ttlIndexArgsFromEnv({ TTL_EXPIRE_SECONDS: '0' })).toBeNull()
        expect(ttlIndexArgsFromEnv({ TTL_EXPIRE_SECONDS: '-5' })).toBeNull()
    })
})

describe('TTL index / record alignment (regression guard for the broken ttl__ts index)', () => {
    it('the TTL index field path resolves to the BSON Date buildRecord stamps', () => {
        const doc = buildRecord('ioniq/parsed/bms/2101', '{"_type":"ioniq","soc":36}', new Date('2026-07-14T00:00:00.000Z'))
        const value = TTL_FIELD_PATH.split('.').reduce((o, k) => (o == null ? o : o[k]), doc)
        // If the index targeted top-level "_ts" (the production bug), this would be
        // undefined and Mongo's TTL monitor would never expire anything.
        expect(value).toBeInstanceOf(Date)
    })
})
