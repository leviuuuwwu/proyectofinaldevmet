// Advisory lock guarding the search index: indexer batches take it SHARED (several
// indexers may run), the rebuild takes it EXCLUSIVE (indexer writes pause; reads don't).
export const INDEX_LOCK = 42_042_001;
