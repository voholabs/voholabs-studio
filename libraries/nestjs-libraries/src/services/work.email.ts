// New accounts have to use a work address, whether they sign up with a
// password or with Google: the free plan is traded for a lead, and a personal
// or throwaway inbox is not one. Accounts that already exist keep signing in,
// and somebody accepting a team invitation is never checked.
//
// Both lists are the common cases, not every domain that exists. A throwaway
// domain that is missing still has to pass email activation before it gets in.

const personalDomains = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'web.de',
  'mail.com',
  'email.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'tuta.io',
  'tutamail.com',
  'zohomail.com',
  'hushmail.com',
  'rediffmail.com',
  'libero.it',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'laposte.net',
  't-online.de',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'cox.net',
  'btinternet.com',
  'duck.com',
];

// yahoo.co.uk, hotmail.fr, outlook.de, live.nl...
const personalBrands = ['yahoo', 'hotmail', 'outlook', 'live'];

const disposableDomains = [
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'pokemail.net',
  'spam4.me',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  'tempmail.net',
  'tempmailo.com',
  'tempmail.plus',
  'tempr.email',
  'tmpmail.org',
  'tmpmail.net',
  'tmail.ws',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'trashmail.de',
  'trash-mail.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'getnada.com',
  'nada.email',
  'dispostable.com',
  'maildrop.cc',
  'mailnesia.com',
  'mailcatch.com',
  'mintemail.com',
  'mohmal.com',
  'moakt.com',
  'fakeinbox.com',
  'fakemail.net',
  'fakemailgenerator.com',
  'emailondeck.com',
  'mytemp.email',
  'mail-temp.com',
  'mailtemp.net',
  'burnermail.io',
  'inboxkitten.com',
  'inboxbear.com',
  'spamgourmet.com',
  'mailsac.com',
  'harakirimail.com',
  'discard.email',
  'discardmail.com',
  'luxusmail.org',
  'cs.email',
  'emltmp.com',
  'dropmail.me',
  '1secmail.com',
  '1secmail.net',
  '1secmail.org',
  'mail.tm',
  'internxt.com',
  'anonaddy.me',
  'simplelogin.co',
  'simplelogin.com',
  'mailnull.com',
  'spambox.us',
  'tempinbox.com',
  'linshiyouxiang.net',
];

const domainOf = (email: string) =>
  (email || '').trim().toLowerCase().split('@').pop() || '';

export const isDisposableEmail = (email: string) => {
  const domain = domainOf(email);
  return disposableDomains.some(
    (blocked) => domain === blocked || domain.endsWith('.' + blocked)
  );
};

export const isPersonalEmail = (email: string) => {
  const domain = domainOf(email);
  return (
    personalDomains.includes(domain) ||
    personalBrands.some((brand) => domain.startsWith(brand + '.'))
  );
};

export const isWorkEmail = (email: string) =>
  !!domainOf(email) && !isDisposableEmail(email) && !isPersonalEmail(email);

export const workEmailMessage = () =>
  "Voholabs Studio needs a work email. Personal addresses like Gmail, Outlook or Yahoo can't be used to sign up.";
