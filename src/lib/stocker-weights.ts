import { calculateAverageWeight } from "@/lib/stocker-labels"

function roundWeight(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

export function getEffectiveInHeadCount(inHeadCount: number | null | undefined, headCount: number | null | undefined) {
  if (typeof inHeadCount === "number" && Number.isFinite(inHeadCount) && inHeadCount > 0) return inHeadCount
  if (typeof headCount === "number" && Number.isFinite(headCount) && headCount > 0) return headCount
  return null
}

export function getEffectiveOutHeadCount(
  outHeadCount: number | null | undefined,
  headCount: number | null | undefined,
) {
  if (typeof outHeadCount === "number" && Number.isFinite(outHeadCount) && outHeadCount > 0) return outHeadCount
  if (typeof headCount === "number" && Number.isFinite(headCount) && headCount > 0) return headCount
  return null
}

export function getAverageInWeight({
  inTotalWeight,
  inHeadCount,
  headCount,
}: {
  inTotalWeight: number | null | undefined
  inHeadCount: number | null | undefined
  headCount: number | null | undefined
}) {
  return calculateAverageWeight(inTotalWeight, getEffectiveInHeadCount(inHeadCount, headCount))
}

export function getAverageOutWeight({
  outTotalWeight,
  outHeadCount,
  headCount,
}: {
  outTotalWeight: number | null | undefined
  outHeadCount: number | null | undefined
  headCount: number | null | undefined
}) {
  return calculateAverageWeight(outTotalWeight, getEffectiveOutHeadCount(outHeadCount, headCount))
}

export function splitLotWeightSnapshot({
  currentHeadCount,
  movedCount,
  inTotalWeight,
}: {
  currentHeadCount: number
  movedCount: number
  inTotalWeight: number | null | undefined
}) {
  const remainingHeadCount = currentHeadCount - movedCount

  if (
    currentHeadCount <= 0 ||
    movedCount <= 0 ||
    movedCount >= currentHeadCount
  ) {
    return {
      sourceInHeadCount: null,
      sourceInTotalWeight: null,
      newInHeadCount: null,
      newInTotalWeight: null,
    }
  }

  if (
    inTotalWeight === null ||
    inTotalWeight === undefined ||
    !Number.isFinite(inTotalWeight)
  ) {
    return {
      sourceInHeadCount: remainingHeadCount,
      sourceInTotalWeight: null,
      newInHeadCount: movedCount,
      newInTotalWeight: null,
    }
  }

  const averageInWeight = inTotalWeight / currentHeadCount

  return {
    sourceInHeadCount: remainingHeadCount,
    sourceInTotalWeight: roundWeight(averageInWeight * remainingHeadCount),
    newInHeadCount: movedCount,
    newInTotalWeight: roundWeight(averageInWeight * movedCount),
  }
}

export function mergeLotWeightSnapshot({
  destinationHeadCount,
  destinationInHeadCount,
  destinationInTotalWeight,
  addedHeadCount,
  addedInHeadCount,
  addedInTotalWeight,
}: {
  destinationHeadCount: number
  destinationInHeadCount: number | null | undefined
  destinationInTotalWeight: number | null | undefined
  addedHeadCount: number
  addedInHeadCount: number | null | undefined
  addedInTotalWeight: number | null | undefined
}) {
  if (
    destinationInTotalWeight === null ||
    destinationInTotalWeight === undefined ||
    !Number.isFinite(destinationInTotalWeight) ||
    addedInTotalWeight === null ||
    addedInTotalWeight === undefined ||
    !Number.isFinite(addedInTotalWeight)
  ) {
    return {
      inHeadCount: destinationInHeadCount ?? null,
      inTotalWeight: destinationInTotalWeight ?? null,
    }
  }

  const baseHeadCount = getEffectiveInHeadCount(destinationInHeadCount, destinationHeadCount)
  const incomingHeadCount = addedInHeadCount ?? addedHeadCount

  if (baseHeadCount === null || incomingHeadCount <= 0) {
    return {
      inHeadCount: destinationInHeadCount ?? null,
      inTotalWeight: destinationInTotalWeight ?? null,
    }
  }

  return {
    inHeadCount: baseHeadCount + incomingHeadCount,
    inTotalWeight: roundWeight(destinationInTotalWeight + addedInTotalWeight),
  }
}
