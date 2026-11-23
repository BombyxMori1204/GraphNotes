const DP_PER_INCH = 160;
const MILLIMETERS_PER_INCH = 25.4;
const BASE_NODE_DIAMETER = 46;
const MIN_NODE_DIAMETER = 56;
const MAX_NODE_DIAMETER = 108;

export function mmToDp(millimeters: number): number {
  return (millimeters * DP_PER_INCH) / MILLIMETERS_PER_INCH;
}

export function getTopicNodeDiameter(itemCount: number): number {
  const diameter =
    BASE_NODE_DIAMETER * Math.sqrt(Math.max(0, itemCount));
  return Math.min(
    MAX_NODE_DIAMETER,
    Math.max(MIN_NODE_DIAMETER, diameter),
  );
}
