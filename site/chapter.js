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
  lede: 'A family of students at KNUST who love God, love His Word, and genuinely '
      + 'love one another. Sunday mornings, midweek evenings, prayer on the Parade '
      + 'grounds — there is always something happening, and always room for one '
      + 'more. Come exactly as you are.',

  // ---- a photo behind the heading ---------------------------------------
  // Put the file in this folder's images/ directory and write the path
  // relative to it. Blank keeps the purple-and-gold gradient, which is a
  // perfectly good header - only use a photo if it is a good one.
  //
  // WHAT MAKES A GOOD ONE: wide rather than tall (it is cropped to a band),
  // busy at the edges rather than the middle, since the heading sits over the
  // centre. A congregation, the auditorium, the campus.
  //
  // SIZE IT FIRST. About 1600px wide and under 300KB. A 4MB photo straight off
  // a phone costs a fresher on campus data real money and several seconds, and
  // it is the first thing on the page - nothing else shows until it loads.
  heroImage: 'images/header.jpg',

  // 'dark' puts the heading in white over a darkened photo. 'light' keeps the
  // purple heading and lays a pale wash over instead. Dark suits most photos;
  // try light only if yours is very pale.
  heroImageTone: 'dark',

  // ---- when and where you meet ---------------------------------------
  // Each line is one meeting. Leave the list empty and the whole section goes.
  serviceTimes: [
    { what: 'Sunday Service',      when: 'Sundays, 6:20am',   where: 'Acci Ayeduase Auditorium' },
    { what: 'Holy Ghost Drink-up', when: 'Sundays, 4:00pm',   where: 'Acci Ayeduase Auditorium' },
    { what: 'Midweek Service',     when: 'Thursdays, 6:30pm', where: 'Acci Ayeduase Auditorium' },
    { what: 'Prayer Meeting',      when: 'Tuesdays, 6:30pm',  where: 'Royal Parade grounds' },
  ],
  address: 'Acci Ayeduase Auditorium, KNUST, Kumasi',
  // Paste a Google Maps link to your meeting place. Blank hides the button.
  mapUrl: 'https://maps.app.goo.gl/UzeXchSvjjCmi3nH9?g_st=aw',

  // ---- what you believe ----------------------------------------------
  story: 'ACONSU began with a simple conviction: that the years a student spends '
       + 'on this campus are some of the most formative of their life, and that God '
       + 'means to meet them here — in the lecture hall, in the hostel, in the small '
       + 'hours before an exam. So we do what the early church did. We open the Word '
       + 'together, we pray together, we eat together, and we carry one another. A '
       + 'degree is worth having. A generation raised in Christ is worth far more.',
  belief: 'We hold the Scriptures as the final authority for what we believe and how '
        + 'we live, and everything else follows from that. We are here to help every '
        + 'student grow in Christ, find the gift God has put in them, and carry that '
        + 'fire with them — into every hall, every hostel, every workplace and every '
        + 'city they go on to.',
  vision: 'Raising students who continue steadfastly in Christ and carry His life '
        + 'into every campus, every workplace and every city they walk into.',
  values: 'Scripture, prayer, fellowship, service and holy living. Not slogans on a '
        + 'wall — the five things our week is actually built around.',

  // ---- the wider church, and the men who began it -------------------------
  // This chapter is one part of The Apostles' Continuation Church, not the
  // whole of it, and the men who founded the church are not the chapter's own
  // leadership. So they get their own section, under the CHURCH's logo rather
  // than the chapter's, and above the coordinators who lead here.
  //
  // Leave `founders` empty and blank the logo and the whole section goes.
  church: {
    name: "The Apostles' Continuation Church",
    // The general logo of the whole church. Put the file in images/ and write
    // the path relative to this folder. A logo is fitted whole rather than
    // cropped, so it keeps whatever space was drawn around it; a PNG keeps its
    // transparency.
    logo: '',        // e.g. 'images/church-logo.png'
    blurb: 'Our chapter is one part of the wider church — one fraction of a family '
         + 'that has been continuing steadfastly a good deal longer than any of us '
         + 'have been on this campus.',
  },

  // The founding fathers. Same rule as everywhere else: somebody with no photo
  // yet gets their initials in a circle, so put the names up now and add the
  // pictures when you have them. A row with no name is skipped entirely.
  //
  // `inMemoriam: true` marks one who has gone. It adds a quiet line under the
  // card rather than changing the picture, so the card reads the same as the
  // others.
  founders: [
    { name: 'Apostle E. K. Owusu', role: 'Founder',
      about: 'He saw the vision and believed the word of the Lord. Galatians 5:19-25 '
           + 'was the passage he carried everywhere, and the one he began the '
           + 'movement on.',
      photo: 'images/church-founder.jpg', inMemoriam: false },

    { name: 'Apostle Clement Brakatu', role: 'Chairman of the Church',
      about: 'His dedication to his faith in Christ led him to resign from his work '
           + 'and join the movement. He was the first man to prophesy, and one of the '
           + 'first ordained Apostles. He planted the church in the Ashanti Region with '
           + 'the help of the Holy Spirit. His ministry exploits extended outside the '
           + 'borders of our continent, to Canada, Europe and the Americas. He is '
           + 'currently the Chairman of the church.',
      photo: 'images/church-chairman.jpg', inMemoriam: false },

    { name: 'Apostle Paul Manu', role: 'Founding Member',
      about: 'A man of sacrifice, who left his government job for full-time ministry. '
           + 'He planted the church across the Bono and Ahafo regions and carried its '
           + 'message as far as Germany — more than 50 churches have come of it.',
      photo: 'images/church-founding-member.jpg', inMemoriam: true },

    { name: 'Apostle Ebenezer Annan', role: 'General Secretary, the Church',
      about: '',
      photo: 'images/church-general-secretary.jpg', inMemoriam: false },
  ],

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
    {
      name: 'Pas. Gideon Amo Darko',
      role: 'Chapter Coordinator',
      about: 'He arrived on this campus as an undergraduate in 2016, served as our '
           + 'Prayer Secretary, and now coordinates the chapter. He carries an '
           + 'apostolic and prophetic gift in the pattern of the Apostle John, '
           + 'teaches the Word with real depth, and has been a father to the whole '
           + 'union.',
      photo: 'images/coordinator-gideon.jpg',
      // Published deliberately, so anyone can reach him. Blank either line and
      // it simply does not appear.
      phone: '+233 54 754 1623',
      email: 'amodarkogideon@gmail.com',
    },
    {
      name: 'Pastor Sarpong',
      role: 'Chapter Coordinator',
      about: 'A seasoned teacher of the Word, a former M.O.G (Men of Glory) and President '
           + 'of the Union. He rightly divides the word of truth, and makes it land '
           + 'with the young and the old alike.',
      photo: 'images/coordinator-sarpong.jpg',
      phone: '+233 54 378 7233',
      email: 'kobbysarpong66@gmail.com',
    },
  ],

  // Just the name and the office. Add or remove rows as the year turns over.
  executives: [
    { position: 'President',                     name: 'James Gyamfi',     photo: 'images/exec-james.jpg' },
    { position: 'Vice President',                name: 'Keziah Gyimah',           photo: 'images/exec-keziah.jpg' },
    { position: 'General Secretary',             name: 'Anna Dompreh',     photo: 'images/exec-anna.jpg' },
    { position: 'Assistant General Secretary',   name: 'Emmanuel Awuah',   photo: 'images/exec-emmanuel.jpg' },
    { position: 'Organizer',                     name: 'Derick Owusu Ansah', photo: 'images/exec-derick.jpg' },
  ],

  // ---- what happens here ----------------------------------------------
  // Remove any that do not apply; add your own. An empty list hides the section.
  //
  // `photo` is optional, per ministry. A card without one starts at its
  // heading rather than showing a grey box, so you can add pictures as you
  // take them. Same sizing advice as the header photo: about 1200px wide is
  // plenty for these - they are shown as a band roughly 400px across.
  ministries: [
    { name: 'Bible Study',
      blurb: 'Verse by verse, book by book — with room for every question you have '
           + 'been afraid to ask out loud.',
      photo: 'images/bible-study.jpg' },

    { name: 'Prayer',
      blurb: 'Standing together for this campus, this nation and each other. No '
           + 'request is too small to bring.',
      photo: 'images/prayer.jpg' },

    { name: 'Music & Worship',
      blurb: 'The sound of the house. If you sing, play, or simply cannot keep '
           + 'still when the music starts, there is a place for you here.',
      photo: 'images/worship.jpg' },

    { name: 'Evangelism',
      blurb: 'Taking the message out of the auditorium and into the halls, the '
           + 'hostels and the streets of Kumasi.',
      photo: 'images/evangelism.jpg' },

    { name: 'Welfare',
      blurb: 'Nobody should go through a hard semester alone. A meal, a hand, a '
           + 'listening ear, somebody checking on you — quietly, and without fuss.',
      photo: 'images/welfare.jpg' },

    { name: 'Media',
      blurb: 'Cameras, sound, screens and everything else that carries a service to '
           + 'the people who could not be in the room.',
      photo: 'images/media.jpg' },
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
    blurb: 'Find us before the homesickness does. Join the freshers group and '
         + 'somebody will be looking out for you on your very first Sunday — by '
         + 'name.',
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
