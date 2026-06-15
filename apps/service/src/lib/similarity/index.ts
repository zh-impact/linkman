export { groupByDomain } from './domain'
export { isSimilarEnough } from './edit-distance'
export { groupByPathPrefix } from './path-prefix'
export {
  detectSimilarity,
  detectEditDistanceInDomain,
  buildDomainBuckets,
  type SimilarityGroup,
  type SimilarityLayer,
} from './detector'
