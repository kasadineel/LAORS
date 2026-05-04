const ANIMAL_EVENT_TYPES = ["NOTE", "WEIGHT", "HEALTH", "BREEDING"] as const

export type AnimalEventType = (typeof ANIMAL_EVENT_TYPES)[number]

export function normalizeAnimalEventType(value: string | null | undefined): AnimalEventType {
  const normalized = value?.trim().toUpperCase()

  switch (normalized) {
    case "WEIGHT":
    case "HEALTH":
    case "BREEDING":
      return normalized
    case "NOTE":
    default:
      return "NOTE"
  }
}

export function getAnimalEventTypeOptions() {
  return ANIMAL_EVENT_TYPES
}

export function getAnimalEventTypeLabel(value: string | null | undefined) {
  switch (normalizeAnimalEventType(value)) {
    case "WEIGHT":
      return "Weight"
    case "HEALTH":
      return "Health"
    case "BREEDING":
      return "Breeding"
    case "NOTE":
    default:
      return "Note"
  }
}
