// The 66 books, their chapter counts and testament — the same list and OSIS ids Selah uses,
// so a reference Cadence computes opens the right chapter in Selah's reader.

export interface Book { id: string; name: string; chapters: number; testament: "OT" | "NT" }

const RAW: [string, string, number, "OT" | "NT"][] = [
  ["Gen", "Genesis", 50, "OT"],
  ["Exod", "Exodus", 40, "OT"],
  ["Lev", "Leviticus", 27, "OT"],
  ["Num", "Numbers", 36, "OT"],
  ["Deut", "Deuteronomy", 34, "OT"],
  ["Josh", "Joshua", 24, "OT"],
  ["Judg", "Judges", 21, "OT"],
  ["Ruth", "Ruth", 4, "OT"],
  ["1Sam", "1 Samuel", 31, "OT"],
  ["2Sam", "2 Samuel", 24, "OT"],
  ["1Kgs", "1 Kings", 22, "OT"],
  ["2Kgs", "2 Kings", 25, "OT"],
  ["1Chr", "1 Chronicles", 29, "OT"],
  ["2Chr", "2 Chronicles", 36, "OT"],
  ["Ezra", "Ezra", 10, "OT"],
  ["Neh", "Nehemiah", 13, "OT"],
  ["Esth", "Esther", 10, "OT"],
  ["Job", "Job", 42, "OT"],
  ["Ps", "Psalms", 150, "OT"],
  ["Prov", "Proverbs", 31, "OT"],
  ["Eccl", "Ecclesiastes", 12, "OT"],
  ["Song", "Song of Solomon", 8, "OT"],
  ["Isa", "Isaiah", 66, "OT"],
  ["Jer", "Jeremiah", 52, "OT"],
  ["Lam", "Lamentations", 5, "OT"],
  ["Ezek", "Ezekiel", 48, "OT"],
  ["Dan", "Daniel", 12, "OT"],
  ["Hos", "Hosea", 14, "OT"],
  ["Joel", "Joel", 3, "OT"],
  ["Amos", "Amos", 9, "OT"],
  ["Obad", "Obadiah", 1, "OT"],
  ["Jonah", "Jonah", 4, "OT"],
  ["Mic", "Micah", 7, "OT"],
  ["Nah", "Nahum", 3, "OT"],
  ["Hab", "Habakkuk", 3, "OT"],
  ["Zeph", "Zephaniah", 3, "OT"],
  ["Hag", "Haggai", 2, "OT"],
  ["Zech", "Zechariah", 14, "OT"],
  ["Mal", "Malachi", 4, "OT"],
  ["Matt", "Matthew", 28, "NT"],
  ["Mark", "Mark", 16, "NT"],
  ["Luke", "Luke", 24, "NT"],
  ["John", "John", 21, "NT"],
  ["Acts", "Acts", 28, "NT"],
  ["Rom", "Romans", 16, "NT"],
  ["1Cor", "1 Corinthians", 16, "NT"],
  ["2Cor", "2 Corinthians", 13, "NT"],
  ["Gal", "Galatians", 6, "NT"],
  ["Eph", "Ephesians", 6, "NT"],
  ["Phil", "Philippians", 4, "NT"],
  ["Col", "Colossians", 4, "NT"],
  ["1Thess", "1 Thessalonians", 5, "NT"],
  ["2Thess", "2 Thessalonians", 3, "NT"],
  ["1Tim", "1 Timothy", 6, "NT"],
  ["2Tim", "2 Timothy", 4, "NT"],
  ["Titus", "Titus", 3, "NT"],
  ["Phlm", "Philemon", 1, "NT"],
  ["Heb", "Hebrews", 13, "NT"],
  ["Jas", "James", 5, "NT"],
  ["1Pet", "1 Peter", 5, "NT"],
  ["2Pet", "2 Peter", 3, "NT"],
  ["1John", "1 John", 5, "NT"],
  ["2John", "2 John", 1, "NT"],
  ["3John", "3 John", 1, "NT"],
  ["Jude", "Jude", 1, "NT"],
  ["Rev", "Revelation", 22, "NT"],
];

export const BOOKS: Book[] = RAW.map(([id, name, chapters, testament]) => ({ id, name, chapters, testament }));

const byId = new Map(BOOKS.map(b => [b.id.toLowerCase(), b]));
export const bookById = (id: string) => byId.get(id.toLowerCase());

export type Chapter = [string, number];

/** Every chapter of the Bible, Genesis 1 to Revelation 22, in order. */
export const ALL_CHAPTERS: Chapter[] = BOOKS.flatMap(b => Array.from({ length: b.chapters }, (_, i) => [b.id, i + 1] as Chapter));
