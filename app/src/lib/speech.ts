/** Voz en-US del navegador (Web Speech API). */

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return []
  const voices = window.speechSynthesis.getVoices()
  const us = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === 'en-us')
  return us.length ? us : voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
}

/** Las voces cargan de forma asíncrona en Chrome: avisa cuando cambian. */
export function onVoicesChanged(cb: () => void): () => void {
  if (!speechSupported()) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', cb)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', cb)
}

export function speak(text: string, voiceURI: string, rate: number): void {
  if (!speechSupported() || !text) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = rate
  const voices = englishVoices()
  const voice = voices.find((v) => v.voiceURI === voiceURI) ?? voices[0]
  if (voice) u.voice = voice
  synth.speak(u)
}
