/* ---------------------------------------------------------------------------
   The one file a chapter edits.

   Every other file in this folder is the same for every chapter. Change the
   values below, put your own logo and photos in images/, and the site is
   yours. Another chapter copies this folder and changes this file only.

   ANYTHING LEFT BLANK DISAPPEARS. A blank phone number does not render an
   empty row, and a blank service list does not render an empty section — so
   this site is publishable today with half of it filled in, and it will still
   look finished. Fill in the rest as you get it.

   The field names match what the app already asks a chapter for, so if your
   chapter settings are filled in, you already know these answers.
--------------------------------------------------------------------------- */

window.CHAPTER = {
  // ---- who you are ----------------------------------------------------
  name: 'ACONSU — KNUST',
  fullName: "The Apostles' Continuation Students Union",
  institution: 'Kwame Nkrumah University of Science and Technology',
  location: 'Kumasi, Ghana',
  tagline: 'ACONSU!! THE APOSTLES!!!',

  // Shown under the name on the opening screen. One or two sentences.
  lede: 'A campus family devoted to the Word, to fellowship, to prayer — '
      + 'continuing steadfastly in the pattern the apostles left us. Come as you are.',

  // ---- when and where you meet ---------------------------------------
  // Each line is one meeting. Leave the list empty and the whole section goes.
  serviceTimes: [
    { what: 'Sunday Service',   when: 'Sundays, 6:20am',     where: 'Acci Ayeduase Auditorium' },
{ what: 'Holy Ghost Drink-up',   when: 'Sundays, 4:00pm',     where: 'Acci Ayeduase Auditorium' },
     { what: 'Midweek Service',  when: 'Thursdays, 6:30pm',  where: 'Acci Ayeduase Auditorium' },
     { what: 'Prayer Meeting',   when: 'Tuesdays, 6:30pm',     where: 'Royal Parade grounds' },
  ],
  address: 'Acci Ayeduase Auditorium, KNUST, Kumasi',
  // Paste a Google Maps link to your meeting place. Blank hides the button.
  mapUrl: 'https://maps.app.goo.gl/UzeXchSvjjCmi3nH9?g_st=aw',

  // ---- what you believe ----------------------------------------------
  story: 'ACONSU exists to see students encounter God and continue steadfastly '
       + 'in the pattern the apostles left the early church: the Word, fellowship, '
       + 'prayer, and one another. We believe campus life is fertile ground for a '
       + 'generation to be raised — not just academically, but spiritually.',
  belief: 'We hold to the Scriptures as the final authority for faith and living, '
        + 'and we exist to help every student grow in Christ, discover their gifts, '
        + 'and carry that fire into every hostel, lecture hall and city they go on to.',
  vision: 'Raising students who continue steadfastly in Christ and carry His life '
        + 'into every campus and city.',
  values: 'Scripture, prayer, fellowship, service, and holy living remain central '
        + 'to our chapter life.',

  // ---- what happens here ----------------------------------------------
  // Remove any that do not apply; add your own. An empty list hides the section.
  ministries: [
    { name: 'Bible Study',     blurb: 'Working through Scripture together, week by week.' },
    { name: 'Prayer',          blurb: 'Standing together for the campus, the nation and each other.' },
    { name: 'Music & Worship', blurb: 'Leading the family before God in song.' },
    { name: 'Evangelism',      blurb: 'Taking the message into halls, hostels and the city.' },
    { name: 'Welfare',         blurb: 'Looking after one another when life on campus is hard.' },
    { name: 'Media',           blurb: 'Carrying what happens here to those who could not come.' },
  ],

  // ---- a word to carry --------------------------------------------------
  verse: {
    text: 'And they continued steadfastly in the apostles’ doctrine and fellowship, '
        + 'in the breaking of bread, and in prayers.',
    reference: 'Acts 2:42',
  },

  // ---- reaching you ------------------------------------------------------
  contact: {
    email: 'aconsuknust@gmail.com',        // e.g. 'aconsuknust@gmail.com'
    phone: '+233 547541623',        // e.g. '+233 24 000 0000'
    whatsapp: '',     // full link or just the number
    facebook: 'https://www.facebook.com/share/1Efaz1Zg1w/?mibextid=wwXIfr',
    instagram: '',
    youtube: 'https://youtube.com/@aconsu_knust?si=aVWLz2kPJkeoeQip',
    tiktok: 'https://www.tiktok.com/@aconsu.knust?_r=1&_t=ZS-99PFlIdM6Ld',
    twitter: '',
  },

  // ---- the app -----------------------------------------------------------
  // Where members go to sign in. Blank hides every link to it, so this page
  // works on its own before the app is ready to show anyone.
  appUrl: 'https://aconsu-knust-app.onrender.com',
};
