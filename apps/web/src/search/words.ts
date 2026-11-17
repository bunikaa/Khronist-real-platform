const maxTokens = 40
const combiningMarks = /\p{M}/gu
const apostrophes = /[’ʼ‘]/gu
const wrappedWord = /-\s*\n\s*/gu
const tokenPattern = /[\p{L}\p{N}'-]+\.?/gu
const edgeMarks = /^['-]+|['-]+$/gu
const hasDigit = /\p{N}/u
const romanNumeral = /^(?:[ivxlcdm]+|[хіv]+)$/u

const stopWords = new Set([
  ...['або', 'але', 'без', 'біля', 'був', 'була', 'були', 'було', 'буде', 'бути', 'вже', 'від'],
  ...['вона', 'вони', 'воно', 'все', 'всі', 'для', 'його', 'йому', 'коли', 'крім', 'між', 'над'],
  ...['них', 'після', 'під', 'при', 'про', 'так', 'також', 'там', 'тут', 'тим', 'той', 'тому'],
  ...['хто', 'чого', 'чому', 'через', 'щоб', 'яка', 'які', 'який', 'яке', 'якщо', 'таке', 'такий'],
  ...['така', 'такі', 'розкажи', 'поясни', 'скажи', 'означає', 'цей', 'цього', 'ця', 'ці'],
  ...['якому', 'якій', 'якого', 'яких', 'скільки', 'дякую', 'далі', 'привіт', 'справи', 'будь'],
  ...['ласка', 'можна', 'слово', 'слова', 'значення', 'рік', 'року', 'році', 'століття'],
  ...['столітті', 'сторіччя', 'місяць', 'місяця'],
  ...['или', 'что', 'как', 'кто', 'где', 'когда', 'почему', 'это', 'этот', 'эта', 'эти', 'его'],
  ...['ему', 'она', 'они', 'оно', 'был', 'была', 'были', 'было', 'быть', 'под', 'через', 'после'],
  ...['также', 'такое', 'такой', 'который', 'которая', 'которые', 'если', 'чтобы', 'отъ', 'изъ'],
])

const normalized = (text: string) =>
  text.normalize('NFC').replace(combiningMarks, '').replace(apostrophes, "'").toLowerCase()

const wordOf = (token: string) => token.replace(/\.$/u, '').replace(edgeMarks, '')

export const comparableWord = (token: string): string => wordOf(normalized(token))

const isContentWord = (word: string) =>
  word.length > 2 && !hasDigit.test(word) && !romanNumeral.test(word) && !stopWords.has(word)

export const significantWords = (query: string): string[] =>
  (normalized(query).replace(wrappedWord, '').match(tokenPattern) ?? [])
    .map(wordOf)
    .filter((word) => word.length > 0)
    .slice(0, maxTokens)
    .filter(isContentWord)
