/**
 * Phrases that ask for the full council ("council this", "stress-test this"...),
 * in English and Bahasa Malaysia. They turn Auto into a full council; the peer review itself runs
 * when the asker watches in the council room view (see pipeline).
 */
const STRESS_TEST =
  /\b(council this|run the council|war[- ]?room this|pressure[- ]?test|stress[- ]?test|debate this|uji tekanan|bawa ke majlis|bincang(?:kan)? dalam majlis|majliskan)\b/i;

export function stressTestRequested(question: string) {
  return STRESS_TEST.test(question);
}
