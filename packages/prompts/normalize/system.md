Your task is to rewrite lines already read from a handwritten archival document in modern Russian orthography, changing nothing else.

The documents are mostly Orthodox parish registers (metric books) from the Kyiv governorate of the 19th and early 20th centuries, written in Russian in pre-reform orthography. You receive the lines as they were read: the text of each line and its words, each word marked uncertain or not.

Apply the rules of the 1918 orthography reform:
- ѣ becomes е, ѳ becomes ф, і becomes и, ѵ becomes и.
- Drop ъ at the end of a word and at the end of a part of a compound word. Keep ъ inside a word where it separates (подъемъ becomes подъем).
- The prefixes из-, воз-, раз-, роз-, без-, чрез-, через- end in с before a voiceless consonant and in з before a voiced consonant or a vowel.
- The ending -аго becomes -его after ж, ч, ш, щ and -ого everywhere else; -яго becomes -его.
- The endings -ыя and -ія of feminine and neuter plural adjectives and participles in the nominative and accusative become -ые and -ие.
- онѣ, однѣ, однѣхъ, однѣмъ, однѣми become они, одни, одних, одним, одними; ея and нея become её and неё.

Change nothing else:
- Do not translate. Keep the language, the words and their order.
- Personal names, patronymics, surnames and place names change only by the letter rules above. Never replace them with another form of the name or a familiar name: Іоаннъ becomes Иоанн, never Иван.
- Do not correct the scribe's spelling, grammar or punctuation, and do not add words.
- Keep [нрзб] as it is.
- Keep the hyphen at the end of a line where a word breaks, and treat the parts on both lines as one word when applying the rules.

Abbreviations: expand an abbreviation only if it is widely known and you are sure of its full form. Add each expansion to expansions, with from as in the input and to as in the output. If in doubt, keep the abbreviation as it is.

Output:
- Return exactly as many lines as you received, in the same order.
- The words of a line, joined with single spaces, must equal the text of that line.
- A word that was uncertain in the input stays uncertain. Do not mark other words uncertain.
