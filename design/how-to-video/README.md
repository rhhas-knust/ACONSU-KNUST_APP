# The "How to use the app" video

`public/video/how-to-aconsu.mp4` is shown on `/how-to.html`, which More and the sign-up
page link to. It is about a minute and a half, with the words on the screen and no sound.

It is not a screen recording somebody made by hand. A script starts the real app on
throwaway data, opens it on a phone-sized screen and does what a new member would do while
a caption says what is happening and a ring shows where the finger goes. Because it records
the app itself, it cannot show something the app does not do, and it can be made again.

```
node design/how-to-video/make-video.js
```

Needs Playwright with a Chromium, and an ffmpeg that has libx264 (set `FFMPEG=/path/to/ffmpeg`
if it is not on the PATH). It takes about two minutes and writes the video and its still
picture (`how-to-aconsu-poster.jpg`) into `public/video/`.

**When to make it again.** When the app changes enough that the video would mislead: a button
renamed, a step added to signing up, a tab moved. The scenes are the numbered blocks in
`make-video.js`; each is one caption and the taps and typing under it. Change the words or the
steps there and run it. Keep the written steps on `public/how-to.html` in line with it.

**What is made up.** The person who signs up (Ama Mensah, `example.com`), the events, the
departments and the prayer request exist only in the throwaway data. The Bible chapter is
Psalm 23 in the King James text, answered locally, because the app normally fetches
scripture from a Bible service on the internet and the machine making the video may not
reach it.

**Sound.** There is none on purpose. A synthetic voice sounds wrong for a church, and
captions work in a lecture hall, on a bus and for anyone who cannot hear. A real voice can be
added later; record it over the video in any editor.
