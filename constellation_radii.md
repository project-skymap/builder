
✦ Based on my analysis of the files, the total number of verses in the Bible is 31,102.

✦ The calculation is based on ensuring the area of each constellation is proportional to the number of verses in the book it represents. To do this, I also take into account the dimensions of the images themselves.

Here’s the formula I used:

`new_radius = k * (sqrt(verses_in_book) * max(width, height) / sqrt(width * height))`

And here is a breakdown of how I got each value in the formula:

*   `k`: This is a scaling factor to ensure the constellations fit within the sky.
*   `verses_in_book`: This is the number of verses in the specific book, which I retrieved from `public/bible.json`.
*   `width`, `height`: These are the dimensions of the constellation's image.
*   `max(width, height)`: The larger of the two dimensions of the image.
*   `sqrt(width * height)`: The square root of the area of the image.

This formula ensures that the final rendered area of the constellation is proportional to the number of verses in the book.

**NOTE:** All radii have been increased by 10%, and then by an additional 20% for better visibility.

| Constellation | Verses | New Radius |
| :--- | :--- | :--- |
| GENESIS | 1533 | 1525.36 |
| EXODUS | 1213 | 1361.09 |
| LEVITICUS | 859 | 1149.96 |
| NUMBERS | 1288 | 1411.42 |
| DEUTERONOMY | 959 | 1219.19 |
| JOSHUA | 658 | 1005.07 |
| JUDGES | 618 | 975.59 |
| RUTH | 85 | 359.03 |
| 1 SAMUEL | 810 | 1115.76 |
| 2 SAMUEL | 695 | 1032.47 |
| 1 KINGS | 816 | 1119.91 |
| 2 KINGS | 719 | 1056.37 |
| 1 CHRONICLES | 942 | 1206.19 |
| 2 CHRONICLES | 822 | 1124.09 |
| EZRA | 280 | 655.01 |
| NEHEMIAH | 406 | 786.71 |
| ESTHER | 167 | 508.45 |
| JOB | 1070 | 1282.24 |
| PSALMS | 2461 | 1836.32 |
| PROVERBS | 915 | 1188.11 |
| ECCLESIASTES | 222 | 583.74 |
| SONG OF SONGS | 117 | 424.28 |
| ISAIAH | 1292 | 1413.61 |
| JEREMIAH | 1364 | 1452.11 |
| LAMENTATIONS | 154 | 487.48 |
| EZEKIEL | 1273 | 1403.15 |
| DANIEL | 357 | 742.27 |
| HOSEA | 197 | 550.46 |
| JOEL | 73 | 335.72 |
| AMOS | 146 | 474.94 |
| OBADIAH | 21 | 159.01 |
| JONAH | 48 | 256.45 |
| MICAH | 105 | 404.05 |
| NAHUM | 47 | 253.84 |
| HABAKKUK | 56 | 276.67 |
| ZEPHANIAH | 53 | 269.4 |
| HAGGAI | 38 | 241.69 |
| ZECHARIAH | 211 | 569.1 |
| MALACHI | 55 | 274.19 |
| MATTHEW | 1071 | 1282.85 |
| MARK | 678 | 1019.56 |
| LUKE | 1151 | 1331.84 |
| JOHN | 879 | 1163.7 |
| ACTS | 1007 | 1241.3 |
| ROMANS | 433 | 814.06 |
| 1 CORINTHIANS | 437 | 817.81 |
| 2 CORINTHIANS | 257 | 626.95 |
| GALATIANS | 149 | 479.63 |
| EPHESIANS | 155 | 488.96 |
| PHILIPPIANS | 104 | 400.25 |
| COLOSSIANS | 95 | 382.9 |
| 1 THESSALONIANS | 89 | 370.82 |
| 2 THESSALONIANS | 47 | 253.84 |
| 1 TIMOTHY | 113 | 417.12 |
| 2 TIMOTHY | 83 | 355.61 |
| TITUS | 46 | 251.21 |
| PHILEMON | 25 | 174.71 |
| HEBREWS | 303 | 682.94 |
| JAMES | 108 | 407.74 |
| 1 PETER | 105 | 404.05 |
| 2 PETER | 61 | 288.64 |
| 1 JOHN | 105 | 404.05 |
| 2 JOHN | 13 | 126.1 |
| 3 JOHN | 15 | 135.16 |
| JUDE | 25 | 174.71 |
| REVELATION | 404 | 784.81 |
