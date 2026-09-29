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

  // ---- who leads the chapter --------------------------------------------
  // Two lists, both optional. An empty list hides its half; empty both and the
  // whole Leadership section goes.
  //
  // PHOTOS go in this folder's images/ directory, and the path is written
  // relative to it: 'images/coordinator-ama.jpg'. Somebody with no photo yet
  // gets their initials in a circle rather than a broken image, so you can add
  // the names now and the pictures when you have them.
  //
  // A NOTE ON PHONE NUMBERS. This page is on the open internet - anyone can
  // read it, and so can anything that scrapes it. That is a different thing
  // from a number inside the app, which is behind a login. Leave `phone` blank
  // and the line simply does not appear; an email alone is often enough.
  coordinators: [
    // {
    //   name: 'Yaw Mensah',
    //   role: 'Chapter Coordinator',
    //   about: 'One or two sentences — how long they have served, what they carry.',
    //   photo: 'images/coordinator-yaw.jpg',
    //   phone: '',
    //   email: '',
    // },
  ],

  // Just the name and the office. Add or remove rows as the year turns over.
  executives: [
    // { position: 'President',             name: '', photo: '' },
    // { position: 'Vice President',        name: '', photo: '' },
    // { position: 'General Secretary',     name: '', photo: '' },
    // { position: 'Organising Secretary',  name: '', photo: '' },
  ],

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

  // ---- freshers ----------------------------------------------------------
  // A band near the top of the page, for the weeks when new students are
  // arriving and need one obvious next step. Blank the link and the whole band
  // disappears, so it comes down by deleting one line when freshers' week is
  // over.
  //
  // THE LINK can be either of two things, and they are not the same:
  //
  //   1. A GROUP INVITE   https://chat.whatsapp.com/XXXXXXXXXXXX
  //      In WhatsApp: open the group -> tap its name -> Invite to group via
  //      link -> Copy link. Paste the whole thing here. This is almost
  //      certainly what you want for a freshers group.
  //
  //   2. ONE PERSON'S NUMBER   0547541623  (or +233547541623)
  //      Just type the number. It becomes a chat with that person, and the
  //      `message` below is typed in for them so they do not have to open
  //      with "hi".
  //
  // A group invite cannot carry a prefilled message - WhatsApp does not allow
  // it - so `message` is ignored for one.
  freshers: {
    heading: 'New on campus?',
    blurb: 'Come and find us. Join the freshers group and somebody will look out '
         + 'for you on your first Sunday.',
    buttonLabel: 'Join the freshers WhatsApp group',
    link: 'https://chat.whatsapp.com/ETj54WcQMe14bc4kAwwAFd?s=cl&p=i&mlu=0&ilr=4',
    message: "Hi! I'm a fresher and I'd like to join ACONSU.",
  },

  // ---- reaching you ------------------------------------------------------
  // Your country's dialling code, no + and no zeros. Ghana is 233. It is used
  // to turn a local number like 0547541623 into the international form WhatsApp
  // needs, so you can write numbers the normal way everywhere on this page.
  countryCode: '233',

  contact: {
    email: 'aconsuknust@gmail.com',        // e.g. 'aconsuknust@gmail.com'
    phone: '+233 547541623',        // e.g. '+233 24 000 0000'
    whatsapp: 'https://chat.whatsapp.com/Clo28L7xENEKsaeqmRJchC?s=sw&p=a&mlu=4&ilr=4',     // full link or just the number
    facebook: 'https://www.facebook.com/share/1Efaz1Zg1w/?mibextid=wwXIfr',
    instagram: '',
    youtube: 'https://youtube.com/@aconsu_knust?si=aVWLz2kPJkeoeQip',
    tiktok: 'https://www.tiktok.com/@aconsu.knust?_r=1&_t=ZS-99PFlIdM6Ld',
    twitter: '',
  },

  // ---- the app -----------------------------------------------------------
  // Where members go to sign in. Blank hides every link to it, so this page
  // works on its own before the app is ready to show anyone.
  //appUrl: 'https://aconsu-knust-app.onrender.com',
};
