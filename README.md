# Ear Training

A fully static web app for musical ear training. Practice single notes, scales, and triads using piano or trumpet samples. The app does not send usage data and requires no backend or database.

## Projektstruktur

```text
index.html
css/styles.css
js/app.js
js/audio-engine.js
js/game-engine.js
js/music-data.js
js/statistics.js
js/storage.js
audio/piano/
audio/trumpet/
licenses/
```

## Voraussetzungen und Start

You need a modern browser with ES module and Web Audio support. There are no npm dependencies or build step.

In VS Code, run the project with the Live Server extension. Alternatively, run this from the project directory:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in your browser. A local HTTP server is required because browsers restrict JavaScript modules and local audio files under `file://`, and this app uses `fetch()`.

## Audio files

Selected piano and trumpet samples from the credited repositories are included in `audio/piano/` and `audio/trumpet/`. The app uses only these local files at runtime; it has no synthesizer fallback and does not download samples.

The included source pitches are C3, Eb3, F#3, A3, C4, Eb4, F#4, A4, C5, Eb5, F#5, A5, and C6 for piano; and C3, Eb3, G3, Bb3, D4, F4, A4, and C5 for trumpet. The source-pitch map in `js/music-data.js` is the authoritative list. All other pitches are played from the nearest mapped sample, transposed by at most three semitones.

Piano FLAC samples are converted from the Salamander V3 source recordings; trumpet WAV samples are converted from VSCO 2 CE sustained notes. Conversion changes file format only. Full attribution and license notices are in `licenses/`, and are also available from the Sample credits popover in Settings.

Filenames use the international note name and octave, for example:

```text
C4.mp3
Cs4.mp3
D4.mp3
Ds4.mp3
E4.mp3
F4.mp3
Fs4.mp3
G4.mp3
Gs4.mp3
A4.mp3
As4.mp3
B4.mp3
```

`B4.mp3` is the international B note; its German note name is **H**. `As4.mp3` is the technical sharp spelling and represents **B-flat (Bb)** in the English UI. Technical filenames must not contain special characters, spaces, `#`, `♯`, or `♭`.

The supported pitch range is C3 through C6. The mapped source pitches listed above are included. An exact sample is preferred; otherwise the nearest mapped sample is used, with transposition limited to three semitones. To extend coverage, add a legal source pitch to `SAMPLE_MAPS` and put its MP3 in the matching instrument folder. The sample test view reports actual coverage and missing files.

The sample test only loads audio after an explicit user action. For each note, it shows the status, expected path, and (when transposed) the source sample and semitone difference.

## Settings and data

Settings and statistics are saved in this browser's `localStorage`. AudioBuffers and AudioContexts are not stored. Accuracy is calculated from correct answers divided by total answers; it is 0% when there are no answers.

Export and import statistics as JSON from the Statistics view. Import only replaces existing data after confirmation, accepts the supported data version, and keeps only known fields.

Add `?debug=true` to the URL to show the debug panel. It includes the current question and settings, audio state, cache and source information, and recent errors. It avoids unnecessary browser details.

## GitHub Pages

1. Open the repository Settings.
2. Open Pages.
3. Select “Deploy from a branch”.
4. Select the `main` branch.
5. Select the `/ (root)` folder.
6. Save and wait for deployment.

All app, audio, and CSS paths are relative, so they work in a repository subdirectory such as `https://username.github.io/ear-training-game/`. Do not replace relative paths with domain-root paths.

Before uploading, verify that each sample's license permits redistribution of its audio files. The notes in `licenses/` do not replace checking the exact source, version, and license terms.

## License notes

Salamander Grand Piano V3 by Alexander Holm is licensed under Creative Commons Attribution 3.0 Unported. VSCO 2 Community Edition by Versilian Studios is licensed under CC0 1.0 Universal according to its repository. Check the original terms before redistributing the included converted samples.

## Known limitations

- The included sample set is intentionally compact rather than a full instrument library. The sample test view shows exact and transposed coverage.
- The selected VSCO trumpet samples reach C5; with the three-semitone transposition cap, pitches above Eb5 through C6 are not covered for trumpet. The Hard sample check reports these uncovered notes.
- The sample maps are editable. Extending them requires adding the corresponding legally obtained audio files.
- Checking samples fetches the requested files and requires a local HTTP connection at that time.
- The app has no service worker; decoded samples stay cached in memory for the current page session.
- Browser audio can only start after a deliberate user interaction.

## Manual test checklist

### Audio

- [ ] No sound plays while the page loads.
- [ ] Audio can play after selecting Start.
- [ ] Replay does not overlap sounds.
- [ ] A new sound stops the previous one.
- [ ] Chord notes start together.
- [ ] Scale notes have even spacing.
- [ ] The volume control works.
- [ ] Piano and trumpet use different folders.

### Spiellogik

- [ ] There are always exactly three answers.
- [ ] Exactly one answer is correct.
- [ ] The correct answer does not have a fixed position.
- [ ] The same question does not repeat immediately.
- [ ] All answer buttons are disabled after answering.
- [ ] The next question is only available after answering.
- [ ] Chords stay within the available pitch range.
- [ ] Scales stay within the available pitch range.

### Statistics

- [ ] Accuracy is calculated correctly.
- [ ] An incorrect answer resets the current streak.
- [ ] The best streak is retained.
- [ ] Data persists after reloading the page.
- [ ] Reset requires confirmation.
- [ ] Export creates a JSON file.
- [ ] Invalid JSON files are rejected during import.

### Barrierefreiheit

- [ ] All controls are reachable with Tab.
- [ ] Focus is visible.
- [ ] Keys 1, 2, and 3 select answers.
- [ ] Space replays the question.
- [ ] Feedback is not conveyed by color alone.
- [ ] Screen readers receive feedback through `aria-live`.

## Validation

Check JavaScript syntax without installing dependencies:

```sh
for file in js/*.js; do node --check "$file" || exit 1; done
```