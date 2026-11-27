export function toInt(addr: string): number | null
export function parseCidr(cidr: string): { base: number; mask: number } | null
export function ipInCidr(ip: string, cidr: string): boolean
export function cidrsOverlap(a: string, b: string): boolean
