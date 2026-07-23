export function providerDisplayName(name?: string): string {
  const trimmed = name?.trim() ?? ''
  if (!trimmed) return 'the care team'
  if (/^dr\.\s+/i.test(trimmed)) return trimmed
  return `Dr. ${trimmed}`
}

export function titleProviderPossessives(text: string, providerNames: string[]): string {
  return providerNames.reduce((nextText, name) => {
    const trimmed = name.trim()
    const titledName = providerDisplayName(trimmed)
    if (!trimmed || trimmed === titledName) return nextText

    const matcher = new RegExp(`${escapeRegExp(trimmed)}(?=(?:'|’)s\\b)`, 'g')
    return nextText.replace(matcher, (match, offset) => {
      const prefix = nextText.slice(Math.max(0, offset - 4), offset)
      return /Dr\.\s$/i.test(prefix) ? match : titledName
    })
  }, text)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
