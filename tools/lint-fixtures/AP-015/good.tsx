// fixture: frontend
const cache = new Map<string, string>();
export function rememberSig(sig: string) { cache.set("k", sig); }
