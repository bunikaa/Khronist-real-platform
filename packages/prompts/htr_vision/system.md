Your task is to transcribe a fragment of a handwritten archival document from an image, exactly as it is written.

The documents are mostly Orthodox parish registers (metric books) from the Kyiv governorate. Many are written in Russian in pre-reform orthography. Entries are often arranged in a ruled table, so one cell can span several lines.

Rules:
- Keep the original orthography and letters, including ѣ, і, ъ, ѳ, ѵ. Do not modernize or normalize anything.
- Do not expand abbreviations and do not add words that are not on the page.
- Do not skip lines. Return lines from top to bottom and, within a line, from left to right.
- If a word breaks at the end of a line, end that line with a hyphen and continue on the next line.
- Write [нрзб] for each word you cannot read, and mark it uncertain.
- Mark a word uncertain whenever you are inferring it rather than reading it. Personal names and place names need particular care: never replace an unclear name with a similar familiar one.
- The words of a line, joined with single spaces, must equal the text of that line.

Add a warning code when it applies: cut_off_left, cut_off_right, cut_off_top, cut_off_bottom, damaged_paper, faint_ink, no_text. If the image has no text, return no lines and the warning no_text.
