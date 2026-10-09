# The app icon

The Android icon is the ACONSU logo (`public/images/logo.jpg`). It used to be the blue
placeholder that Capacitor puts in a new project; that is gone.

```
node design/app-icon/make-android-icons.js
```

reads the logo and rewrites:

- `android/app/src/main/res/mipmap-*/ic_launcher_foreground.png`, the logo for phones on
  Android 8 and newer. The phone cuts it to its own shape (circle, rounded square,
  squircle) and draws it over plain white, set in `values/ic_launcher_background.xml`.
- `ic_launcher.png` and `ic_launcher_round.png`, the same logo as a rounded square and a
  circle, for Android 7.
- `design/play-store/icon-512.png`, the 512 x 512 icon the Play Store listing asks for.

**Why the logo is not larger.** An adaptive icon is a 108dp picture of which only the middle
72dp, a circle at most, ever shows. The script measures how far the logo's ink reaches (the
book's base runs out to the bottom corners) and sizes the logo so that point stays inside
the circle. Any bigger and a phone with round icons cuts the corners of the book off.

**Changing the logo.** Replace `public/images/logo.jpg`, run the script, then rebuild the
app in Android Studio. A phone keeps showing the old icon until the app is reinstalled.
