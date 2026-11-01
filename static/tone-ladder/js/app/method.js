/* Tone Ladder — Method. */
import { esc } from './base.js';

  // ======================================================================
  // METHOD
  // ======================================================================
  function viewMethod() {
    const P = [
      ['Hear in a key', 'Questions that ask you to name or sing a note start with four chords that set the key (a cadence). You name each note by its place in the key (Do, Re, Mi) rather than as an isolated distance. After each answer the note walks home to Do, so you feel where it pulls.', 'Functional ear training (Alain Benbassat); movable-do solfège as used in the Kodály approach.'],
      ['Sound before symbol', 'You meet each new sound by listening and singing before you are tested on its name. Names attach to sounds you already know, not the other way round.', 'Edwin Gordon’s Music Learning Theory; Kodály.'],
      ['One new thing at a time', 'You start with Do and Sol, which sound very different, and add a single note when the current set is solid. Coarse distinctions come first, fine ones later.', 'Perceptual learning; Gary Karpinski, Aural Skills Acquisition (2000).'],
      ['Mastery before moving on', 'A level opens when 18 of your last 20 answers are right (16 points of 20 for singing, where Close counts half and practice rounds are not counted), each new item has been answered correctly a few times, and those answers come from at least two different days, so a night’s sleep has confirmed them. You can always skip ahead if a level is too easy.', 'Mastery learning.'],
      ['Mistakes become contrasts', 'When you confuse two sounds you hear both side by side. The missed item comes back a few questions later, and pairs you often mix up get their own drill on the Progress page.', 'Discrimination training; immediate, informative feedback.'],
      ['Spacing and mixing', 'Items you know come back at growing intervals (1, 2, 4, 8, 16 days). Each session mixes skills. Mixing feels harder at the time and produces more durable learning.', 'Spacing effect (Cepeda et al., 2006); interleaving (Rohrer & Taylor, 2007); “desirable difficulties” (Bjork, 1994).'],
      ['Sing it', 'Singing ties hearing to an internal image of the sound. This is audiation: hearing music in your head, which is what you need to write away from an instrument.', 'Gordon; Kodály.'],
      ['An honest check', 'Beginners cannot yet hear their own pitch errors, so the app can listen through the microphone. It waits until you finish, without a live pitch display, so you sing from the inner ear rather than chase a needle. Then the answer plays while you sing along, and only after that does it show what it heard. A note counts as right when the nearest semitone is the target. You can always lower the grade; raising it means the app misheard, so that round does not count.', 'Singing-accuracy research (Pfordresher and colleagues); feedback after, not during, the attempt (Guadagnoli and Kohl).'],
      ['Vary what doesn’t matter', 'Keys change, registers widen and instruments can rotate, so you learn how a sound behaves in the key rather than memorizing a particular pitch or timbre.', 'Variability of practice.'],
    ];
    return `<div>
      <div class="page-head"><p class="eyebrow">How Tone Ladder teaches</p><h1>The method</h1><p class="lede">The course is built for a composer starting with little ear training. It follows the approaches with the strongest track record in aural-skills teaching, and it schedules practice the way learning research recommends.</p></div>
      <div class="principles">${P.map(([h, p, s]) => `<div class="principle"><h3>${esc(h)}</h3><p>${esc(p)}</p><p class="src">${esc(s)}</p></div>`).join('')}</div>
      <div class="prose" style="margin-top:30px">
        <h2>The tracks, and the order they open</h2>
        <ol>
          <li><strong>Scale Degrees</strong>, every day. Hearing each note by its place in the key is the foundation the other skills sit on.</li>
          <li><strong>Intervals</strong> and <strong>Chord Qualities</strong> from day one. They give you names for distances and colors.</li>
          <li><strong>Melodic Dictation</strong> opens when you reach Scale Degrees level 3. By then Do, Mi and Sol are solid, and you are meeting Re.</li>
          <li><strong>Harmony</strong> opens at Scale Degrees level 4 and Chord Qualities level 2. Hearing a bass line as scale degrees is what makes Roman numerals hearable.</li>
          <li><strong>Rhythm</strong> and <strong>Sing</strong> run alongside everything. Most Sing levels wait until Scale Degrees has taught their notes; Chord tones and Bass lines wait for Harmony to name their chords.</li>
          <li><strong>Sight-Singing</strong> opens when you master Sing a pattern. You read a melody on a staff in its key and sing it; each level waits for the Sing level that taught its notes.</li>
        </ol>
        <h2>How to practice</h2>
        <ul>
          <li><strong>Ten to fifteen minutes a day.</strong> The Today plan is sized for that. Short daily sessions beat long occasional ones.</li>
          <li><strong>Sing out loud</strong>, or hum. If you can sing a note, you can hear it.</li>
          <li><strong>Don’t rush.</strong> Accuracy first. Response time is tracked but never required; speed follows accuracy.</li>
          <li><strong>Expect about 80% right.</strong> Questions are pitched at the edge of what you can hear. Scores in the 70s and 80s mean the training is working.</li>
          <li><strong>Take it to your own music.</strong> Once a week, open a piece you love under Music: loop a passage, hold Do under it, sing its bass line in scale degrees and mark the chords. Before writing a melody down, sing it in solfège first.</li>
        </ul>
        <h2>Further reading</h2>
        <ul class="refs">
          <li>Gary S. Karpinski, <em>Aural Skills Acquisition</em> (Oxford University Press, 2000).</li>
          <li>Edwin E. Gordon, <em>Learning Sequences in Music: A Contemporary Music Learning Theory</em> (GIA Publications).</li>
          <li>Lois Choksy, <em>The Kodály Method</em> (Prentice Hall).</li>
          <li>Alain Benbassat, notes on functional ear training (author of the Functional Ear Trainer app).</li>
          <li>N. J. Cepeda et al., “Distributed practice in verbal recall tasks,” <em>Psychological Bulletin</em> (2006).</li>
          <li>D. Rohrer &amp; K. Taylor, “The shuffling of mathematics problems improves learning,” <em>Instructional Science</em> (2007).</li>
        </ul>
      </div>
    </div>`;
  }

export { viewMethod };
