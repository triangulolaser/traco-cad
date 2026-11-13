// Indexador Espacial 2D de Alta Performance (Onda 3 — FlatHilbertRTree + TombstoneBitset + DeltaBVH).
// Preserva 100% de compatibilidade com a API de SpatialIndex enquanto opera em memória contígua
// (Float64Array / Uint32Array) com zero alocação de nós no Garbage Collector durante pan/zoom/pick.

import {
    PackedSpatialEngine,
    FlatHilbertRTree,
    DeltaBVH,
    SubSegmentBVH,
    getPolylineSubBVH,
    hilbertXYToIndex,
    radixSortHilbert,
} from './spatial-packed.js';

export class SpatialIndex extends PackedSpatialEngine {
    constructor(options = {}) {
        super(options);
    }
}

export {
    PackedSpatialEngine,
    FlatHilbertRTree,
    DeltaBVH,
    SubSegmentBVH,
    getPolylineSubBVH,
    hilbertXYToIndex,
    radixSortHilbert,
};
