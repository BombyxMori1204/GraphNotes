import type { VectorSearchResult } from '@/types';

export async function findNearest(
  queryVector: Float32Array,
  k: number,
): Promise<VectorSearchResult[]> {
  // Future implementation: scan Float32Array embeddings, then replace with sqlite-vec.
  void queryVector;
  void k;
  return [];
}
