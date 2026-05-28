'use strict';
const argon2 = require('argon2');
const crypto = require('node:crypto');

// Curated wordlist of 256 common 3-5 letter English words. 4 picks → 256^4 ≈ 4.3B
// combinations. With argon2id work factor, brute force is impractical for the
// 48-hour token expiry window. Wordlist deliberately avoids ambiguous spellings.
const WORDS = [
  'able','acid','aged','also','area','army','away','baby','back','ball','band',
  'bank','base','bath','bean','bear','beat','been','beer','bell','belt','best',
  'bike','bill','bird','blow','blue','boat','body','bomb','bond','bone','book',
  'boom','born','boss','both','bowl','bulk','burn','bush','busy','call','calm',
  'came','camp','card','care','case','cash','cast','cell','chat','chip','city',
  'club','coal','coat','code','cold','come','cook','cool','cope','copy','core',
  'cost','crew','crop','dark','data','date','dawn','days','dead','deal','dean',
  'dear','debt','deep','deny','desk','dial','diet','disk','done','door','dose',
  'down','draw','drew','drop','drug','dual','duke','dust','duty','each','earn',
  'east','easy','edge','else','even','ever','evil','exit','face','fact','fail',
  'fair','fall','farm','fast','fate','fear','feed','feel','feet','fell','felt',
  'file','fill','film','find','fine','fire','firm','fish','five','flag','flat',
  'flew','flow','food','foot','ford','form','fort','four','free','from','fuel',
  'full','fund','gain','game','gate','gave','gear','gene','gift','girl','give',
  'glad','goal','goes','gold','golf','gone','good','gray','grew','grow','gulf',
  'hair','half','hall','hand','hang','hard','harm','hate','have','head','hear',
  'heat','held','hell','help','here','hero','hide','high','hill','hint','hire',
  'hold','hole','holy','home','hope','host','hour','huge','hung','hunt','hurt',
  'idea','inch','into','iron','item','jack','jane','jean','john','join','jump',
  'jury','just','keen','keep','kept','kick','kind','king','knee','knew','know',
  'lack','lady','laid','lake','land','lane','last','late','lazy','lead','leaf',
  'lean','left','less','life','lift','like','limb','line','link','list','live',
  'load','loan','lock','logo','long','look','lord','lose','loss','lost','loud',
  'love','luck','made',
];

function pickWord() {
  // Use crypto.randomInt to avoid Math.random bias.
  return WORDS[crypto.randomInt(0, WORDS.length)];
}

function generatePassphrase() {
  return [pickWord(), pickWord(), pickWord(), pickWord()].join('-');
}

async function hashPassword(plaintext) {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19456,   // 19 MiB — OWASP minimum recommended
    timeCost: 2,
    parallelism: 1,
  });
}

async function verifyPassword(hash, plaintext) {
  try { return await argon2.verify(hash, plaintext); }
  catch { return false; }
}

module.exports = { generatePassphrase, hashPassword, verifyPassword };
