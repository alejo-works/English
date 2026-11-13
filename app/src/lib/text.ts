/** Utilidades de texto para los modos dictado, cloze y errores. */

export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, '')
}

/** Separa una frase en palabras conservando el texto original de cada una. */
export function tokenize(sentence: string): { raw: string; norm: string }[] {
  return sentence
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: normalizeWord(raw) }))
    .filter((t) => t.norm.length > 0)
}

export type DiffPart =
  | { kind: 'ok'; text: string } // palabra correcta
  | { kind: 'missing'; text: string } // en la frase correcta, falta en la tuya
  | { kind: 'extra'; text: string } // en la tuya, sobra

export interface DiffResult {
  parts: DiffPart[]
  /** aciertos / palabras de la frase correcta, 0-1 */
  score: number
  perfect: boolean
}

/**
 * Compara palabra a palabra (LCS) la respuesta escrita con la frase correcta.
 * Ignora mayúsculas, puntuación y tipo de apóstrofo.
 */
export function diffWords(answer: string, target: string): DiffResult {
  const a = tokenize(answer)
  const t = tokenize(target)
  const n = a.length
  const m = t.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].norm === t[j].norm ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i].norm === t[j].norm) {
      parts.push({ kind: 'ok', text: t[j].raw })
      i++
      j++
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      parts.push({ kind: 'missing', text: t[j].raw })
      j++
    } else {
      parts.push({ kind: 'extra', text: a[i].raw })
      i++
    }
  }
  const ok = parts.filter((p) => p.kind === 'ok').length
  const extra = parts.some((p) => p.kind === 'extra')
  return { parts, score: m ? ok / m : 0, perfect: ok === m && !extra }
}

const OPTIONAL = new Set(['be', 'a', 'an', 'the', 'someone', 'something', 'sb', 'sth'])

/** Palabras clave de una entrada: quita lo que va entre paréntesis y los comodines. */
function keyWords(english: string): string[] {
  return english
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w && !OPTIONAL.has(w))
}

/** ¿El token de la frase es una forma de la palabra clave? (follow → followed, fine-tune → fine-tuned) */
function matches(token: string, word: string): boolean {
  if (token === word) return true
  if (word.length >= 3 && token.startsWith(word)) return token.length - word.length <= 3
  // verbos que pierden la e: hallucinate → hallucinating
  if (word.endsWith('e') && word.length >= 4 && token.startsWith(word.slice(0, -1)) && token.endsWith('ing')) return true
  return false
}

export interface Cloze {
  before: string
  hidden: string
  after: string
}

/**
 * Busca la expresión dentro del ejemplo para taparla. Permite flexiones y hasta 2 palabras
 * intercaladas (phrasal verbs separables: "roll this out"). Si no la encuentra, devuelve null.
 */
export function findCloze(english: string, example: string): Cloze | null {
  const words = keyWords(english)
  if (!words.length) return null
  const raw = example.split(/(\s+)/) // conserva espacios
  const tokens: { idx: number; norm: string }[] = []
  raw.forEach((piece, idx) => {
    if (!/^\s+$/.test(piece) && piece) tokens.push({ idx, norm: normalizeWord(piece) })
  })

  const tryMatch = (ws: string[]): [number, number] | null => {
    for (let s = 0; s < tokens.length; s++) {
      if (!matches(tokens[s].norm, ws[0])) continue
      let pos = s
      let ok = true
      for (let k = 1; k < ws.length; k++) {
        let found = -1
        for (let p = pos + 1; p <= Math.min(tokens.length - 1, pos + 3); p++) {
          if (matches(tokens[p].norm, ws[k])) {
            found = p
            break
          }
        }
        if (found < 0) {
          ok = false
          break
        }
        pos = found
      }
      if (ok) return [s, pos]
    }
    return null
  }

  let span = tryMatch(words)
  if (!span) {
    // Plan B: la palabra clave más larga
    const longest = [...words].sort((a, b) => b.length - a.length)[0]
    if (longest.length >= 4) span = tryMatch([longest])
  }
  if (!span) return null

  const startIdx = tokens[span[0]].idx
  const endIdx = tokens[span[1]].idx
  // separar puntuación pegada al principio o al final del hueco
  const first = raw[startIdx]
  const last = raw[endIdx]
  const lead = first.match(/^[^\p{L}\p{N}]*/u)![0]
  const trail = last.match(/[^\p{L}\p{N}']*$/u)![0]
  const hiddenPieces = raw.slice(startIdx, endIdx + 1)
  hiddenPieces[0] = hiddenPieces[0].slice(lead.length)
  hiddenPieces[hiddenPieces.length - 1] = hiddenPieces[hiddenPieces.length - 1].slice(
    0,
    hiddenPieces[hiddenPieces.length - 1].length - trail.length,
  )
  return {
    before: raw.slice(0, startIdx).join('') + lead,
    hidden: hiddenPieces.join(''),
    after: trail + raw.slice(endIdx + 1).join(''),
  }
}
