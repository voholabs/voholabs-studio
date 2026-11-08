'use client';

import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { showMediaBox } from '@gitroom/frontend/components/media/media.component';
import { useBriefClassic } from '@gitroom/frontend/components/agent-brief/brief.classic';
import {
  isImage,
  useBriefFileUrl,
  useBriefUpload,
} from '@gitroom/frontend/components/agent-brief/brief.assets';
import {
  BRIEF_KIT_COLOR_ROLES,
  BRIEF_KIT_FONT_ROLES,
  BRIEF_KIT_HEX,
  BRIEF_KIT_IMAGERY_MAX,
  BRIEF_KIT_LOGO_VARIANTS,
  isKitEmpty,
  stripHtml,
} from '@gitroom/nestjs-libraries/agent-brief/brief.registry';
import {
  BriefAsset,
  BriefBlock,
  BriefKit,
  BriefKitColor,
  BriefKitColorRole,
  BriefKitFont,
  BriefKitFontRole,
  BriefKitLogo,
  BriefKitLogoVariant,
} from '@gitroom/nestjs-libraries/agent-brief/brief.types';
import { GOOGLE_FONT_FAMILIES } from '@gitroom/nestjs-libraries/agent-brief/google.fonts';

// The four colours every brand has a word for are always on the page; the
// other roles are added on demand.
const CORE_COLORS: readonly BriefKitColorRole[] = [
  'primary',
  'accent',
  'background',
  'text',
];
const FONTS_LIST_ID = 'brief-kit-google-fonts';
const DISMISSED_KEY = 'brief-kit-suggestion-dismissed';

// Google's spelling of each family, looked up without regard to case.
const GOOGLE_FONTS = new Map(
  GOOGLE_FONT_FAMILIES.map((family) => [family.toLowerCase(), family])
);
// Longest first, so "Playfair Display" is found before "Playfair".
const FONTS_BY_LENGTH = [...GOOGLE_FONT_FAMILIES].sort(
  (a, b) => b.length - a.length
);

// "#abc" and "abc" read as "#AABBCC"; anything that is not three or six hex
// digits is not a colour yet.
const toHex = (value: string) => {
  const digits = value.trim().replace(/^#/, '');
  const full = /^[0-9a-f]{3}$/i.test(digits)
    ? digits.replace(/./g, (digit) => digit + digit)
    : digits;
  const hex = `#${full.toUpperCase()}`;
  return BRIEF_KIT_HEX.test(hex) ? hex : undefined;
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

// Everything the kit could take from what is already written on the page: the
// hex codes in the notes, the Google Fonts families named under a font
// heading, the first sentence under an imagery heading, and the files whose
// name or note says logo. Nothing is sent; the user decides.
export const suggestKit = (
  blocks: BriefBlock[],
  assets: BriefAsset[]
): BriefKit => {
  const texts = blocks.map((block) => ({
    heading: block.heading || '',
    body: stripHtml(block.body).replace(/\s+/g, ' ').trim(),
  }));

  const hexes = Array.from(
    new Set(
      texts.flatMap(({ heading, body }) =>
        Array.from(
          `${heading} ${body}`.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)
        )
          .map((match) => toHex(match[0]))
          .filter((hex): hex is string => !!hex)
      )
    )
  ).slice(0, BRIEF_KIT_COLOR_ROLES.length);

  // A near-white is the background and a near-black the text; the rest are
  // brand colours, in the order they were written.
  const byLight = [...hexes].sort((a, b) => luminance(b) - luminance(a));
  const background =
    hexes.length > 1 && luminance(byLight[0]) > 0.85 ? byLight[0] : undefined;
  const text =
    hexes.length > 1 && luminance(byLight[byLight.length - 1]) < 0.2
      ? byLight[byLight.length - 1]
      : undefined;
  const brand = hexes.filter((hex) => hex !== background && hex !== text);
  const brandRoles: BriefKitColorRole[] = [
    'primary',
    'accent',
    'secondary',
    'muted',
    'surface',
  ];
  const colors: BriefKitColor[] = BRIEF_KIT_COLOR_ROLES.flatMap((role) => {
    const hex =
      role === 'background'
        ? background
        : role === 'text'
        ? text
        : brand[brandRoles.indexOf(role)];
    return hex ? [{ role, hex }] : [];
  });

  // Only families Google has, spelled as Google spells them, in the order
  // they appear; "body" or "text" near a name makes it the body font.
  const fontText = texts
    .filter(({ heading }) => /font|typ/i.test(heading))
    .map(({ body }) => body)
    .join('. ');
  const found: { family: string; at: number }[] = [];
  let rest = fontText;
  for (const family of FONTS_BY_LENGTH) {
    if (!rest.includes(family)) {
      continue;
    }
    const match = new RegExp(
      `(^|[^\\w])${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`
    ).exec(rest);
    if (match) {
      const at = match.index + match[1].length;
      found.push({ family, at });
      rest =
        rest.slice(0, at) +
        ' '.repeat(family.length) +
        rest.slice(at + family.length);
    }
  }
  const fonts: BriefKitFont[] = [];
  found
    .sort((a, b) => a.at - b.at)
    .forEach(({ family, at }) => {
      const near =
        (fontText.slice(at).split(/[.;,\n]/)[0] || '') +
        ' ' +
        (fontText
          .slice(0, at)
          .split(/[.;,\n]/)
          .pop() || '');
      const wanted: BriefKitFontRole | undefined =
        /\b(body|text|paragraph|copy)\b/i.test(near)
          ? 'body'
          : /\b(head|heading|headings|headline|headlines|title|titles|display)\b/i.test(
              near
            )
          ? 'headline'
          : undefined;
      const role =
        wanted && !fonts.some((font) => font.role === wanted)
          ? wanted
          : BRIEF_KIT_FONT_ROLES.find(
              (one) => !fonts.some((font) => font.role === one)
            );
      if (role) {
        fonts.push({ role, family });
      }
    });

  const imageryBlock = texts.find(
    ({ heading, body }) =>
      !!body && /imagery|photo|illustration|visual style|look/i.test(heading)
  );
  const imagery = (imageryBlock?.body.match(/^[^.!?]*[.!?]?/)?.[0] || '')
    .trim()
    .slice(0, BRIEF_KIT_IMAGERY_MAX);

  // light: the logo for light backgrounds; dark: a white or inverted one, for
  // dark backgrounds; icon: the square mark.
  const logos: BriefKitLogo[] = [];
  assets.filter(isImage).forEach((asset) => {
    const words = `${asset.name} ${asset.note || ''}`;
    const variant: BriefKitLogoVariant | undefined =
      /favicon|\bicon\b|\bsymbol\b/i.test(words)
        ? 'icon'
        : !/logo/i.test(words)
        ? undefined
        : /dark|white|invers|revers|negative/i.test(words)
        ? 'dark'
        : 'light';
    if (variant && !logos.some((logo) => logo.variant === variant)) {
      logos.push({ variant, url: asset.url });
    }
  });

  return {
    ...(colors.length ? { colors } : {}),
    ...(fonts.length ? { fonts } : {}),
    ...(logos.length
      ? {
          logos: BRIEF_KIT_LOGO_VARIANTS.flatMap((variant) =>
            logos.filter((logo) => logo.variant === variant)
          ),
        }
      : {}),
    ...(imagery ? { imagery } : {}),
  };
};

// The whole kit, every field present, so fields the user emptied are cleared
// on the server rather than kept.
const complete = (kit: BriefKit): BriefKit => ({
  colors: kit.colors || [],
  fonts: kit.fonts || [],
  logos: kit.logos || [],
  imagery: kit.imagery || '',
});

// Loads one family's stylesheet from Google Fonts, once per page, so the
// picker can show the face it names.
const useGoogleFontPreview = (family?: string) => {
  useEffect(() => {
    if (!family || typeof document === 'undefined') {
      return;
    }
    const id = `${FONTS_LIST_ID}-${family.replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) {
      return;
    }
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      family
    ).replace(/%20/g, '+')}&display=swap`;
    document.head.appendChild(link);
  }, [family]);
};

const dismissedKey = (orgId?: string) => `${DISMISSED_KEY}:${orgId || ''}`;

const readDismissed = (orgId?: string) => {
  try {
    return !!localStorage.getItem(dismissedKey(orgId));
  } catch {
    return false;
  }
};

const Section: FC<{ label: string; caption: string; children: ReactNode }> = ({
  label,
  caption,
  children,
}) => (
  <div className="flex flex-col gap-[10px]">
    <div className="flex flex-col gap-[2px]">
      <div className="text-[14px] font-[600]">{label}</div>
      <div className="text-[12px] text-textItemBlur">{caption}</div>
    </div>
    {children}
  </div>
);

const CloseIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
  >
    <path
      d="M12 4L4 12M4 4L12 12"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ColorSwatch: FC<{
  role: BriefKitColorRole;
  label: string;
  hex?: string;
  removable: boolean;
  onChange: (hex?: string) => void;
}> = ({ role, label, hex, removable, onChange }) => {
  const t = useT();
  const classic = useBriefClassic();
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const shown = draft ?? hex ?? '';
  const invalid = draft !== undefined && !!draft.trim() && !toHex(draft);

  return (
    <div className="group flex flex-col items-center gap-[6px] w-[96px]">
      <label
        className={
          hex
            ? 'relative w-[44px] h-[44px] rounded-full border border-newTableBorder cursor-pointer'
            : classic
            ? 'relative w-[44px] h-[44px] rounded-full border border-dashed border-newTableBorder cursor-pointer hover:border-warm transition-colors'
            : 'relative w-[44px] h-[44px] rounded-full border border-dashed border-newTableBorder cursor-pointer hover:border-tealText transition-colors'
        }
        style={hex ? { backgroundColor: hex } : undefined}
      >
        <input
          type="color"
          aria-label={label}
          value={(hex || '#000000').toLowerCase()}
          onChange={(event) => {
            setDraft(undefined);
            onChange(toHex(event.target.value));
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        {removable && (
          <span
            onClick={(event) => {
              event.preventDefault();
              setDraft(undefined);
              onChange(undefined);
            }}
            data-tooltip-id="tooltip"
            data-tooltip-content={t('brief_kit_remove', 'Remove')}
            className="absolute -top-[4px] -end-[4px] hidden group-hover:flex w-[18px] h-[18px] rounded-full bg-newBgColorInner border border-newTableBorder items-center justify-center text-textItemBlur"
          >
            <CloseIcon />
          </span>
        )}
      </label>
      <div className="text-[12px] text-textItemBlur">{label}</div>
      <input
        value={shown}
        aria-label={t('brief_kit_hex_label', '{{role}} hex', { role: label })}
        maxLength={7}
        spellCheck={false}
        placeholder="#RRGGBB"
        onChange={(event) => {
          setDraft(event.target.value);
          // Six digits is a whole colour: no need to wait for the blur.
          const digits = event.target.value.trim().replace(/^#/, '');
          if (/^[0-9a-f]{6}$/i.test(digits)) {
            onChange(toHex(digits));
          }
        }}
        onBlur={() => {
          if (draft === undefined) {
            return;
          }
          if (!draft.trim()) {
            setDraft(undefined);
            onChange(undefined);
            return;
          }
          const next = toHex(draft);
          if (next) {
            setDraft(undefined);
            onChange(next);
          }
        }}
        data-role={role}
        className={
          invalid
            ? 'w-full text-center text-[12px] font-mono bg-transparent outline-none rounded-[6px] border border-danger px-[4px] h-[26px]'
            : 'w-full text-center text-[12px] font-mono bg-transparent outline-none rounded-[6px] border border-newTableBorder px-[4px] h-[26px] placeholder:text-textItemBlur'
        }
      />
    </div>
  );
};

const FontPicker: FC<{
  label: string;
  family?: string;
  onChange: (family?: string) => void;
}> = ({ label, family, onChange }) => {
  const t = useT();
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [unknown, setUnknown] = useState(false);
  useGoogleFontPreview(family);

  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex items-center gap-[12px]">
        <div className="w-[80px] shrink-0 text-[13px] text-textItemBlur">
          {label}
        </div>
        <input
          value={draft ?? family ?? ''}
          list={FONTS_LIST_ID}
          aria-label={label}
          maxLength={100}
          spellCheck={false}
          placeholder={t(
            'brief_kit_font_placeholder',
            'Google Fonts family, e.g. Inter'
          )}
          onChange={(event) => {
            setDraft(event.target.value);
            setUnknown(false);
            const match = GOOGLE_FONTS.get(
              event.target.value.trim().toLowerCase()
            );
            if (match) {
              onChange(match);
            }
          }}
          onBlur={() => {
            if (draft === undefined) {
              return;
            }
            if (!draft.trim()) {
              setDraft(undefined);
              onChange(undefined);
              return;
            }
            const match = GOOGLE_FONTS.get(draft.trim().toLowerCase());
            if (match) {
              setDraft(undefined);
              onChange(match);
              return;
            }
            setUnknown(true);
          }}
          className={
            unknown
              ? 'flex-1 min-w-0 bg-transparent outline-none rounded-[8px] border border-danger px-[10px] h-[36px] text-[14px] placeholder:text-textItemBlur'
              : 'flex-1 min-w-0 bg-transparent outline-none rounded-[8px] border border-newTableBorder px-[10px] h-[36px] text-[14px] placeholder:text-textItemBlur'
          }
        />
        {!!family && !unknown && (
          <div
            className="flex-1 min-w-0 truncate text-[20px]"
            style={{ fontFamily: `'${family}', sans-serif` }}
          >
            {t('brief_kit_font_sample', 'The quick brown fox')}
          </div>
        )}
      </div>
      {unknown && (
        <div className="text-[12px] text-danger ps-[92px]">
          {t(
            'brief_kit_font_unknown',
            'Not saved: "{{family}}" is not a Google Fonts family. Pick one from fonts.google.com, for example "Inter" or "Playfair Display".',
            { family: draft, interpolation: { escapeValue: false } }
          )}
        </div>
      )}
    </div>
  );
};

const LogoSlot: FC<{
  label: string;
  dark: boolean;
  url?: string;
  onChange: (url?: string) => void;
}> = ({ label, dark, url, onChange }) => {
  const t = useT();
  const classic = useBriefClassic();
  const toaster = useToaster();
  const resolve = useBriefFileUrl();
  const store = useBriefUpload();
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (file?: File) => {
      if (!file) {
        return;
      }
      setUploading(true);
      try {
        const { path } = await store(file);
        if (path) {
          onChange(path);
        }
      } finally {
        setUploading(false);
      }
    },
    [onChange, store]
  );

  const fromLibrary = useCallback(
    () =>
      showMediaBox((media) => {
        if (!isImage({ url: media.path })) {
          toaster.show(
            t('brief_kit_logo_not_image', 'Pick an image for the logo.'),
            'warning'
          );
          return;
        }
        onChange(media.path);
      }),
    [onChange, t, toaster]
  );

  const link = classic
    ? 'cursor-pointer select-none text-[12px] text-textItemBlur hover:text-warm transition-colors'
    : 'cursor-pointer select-none text-[12px] text-textItemBlur hover:text-tealText transition-colors';

  return (
    <div className="flex flex-col gap-[6px] w-[160px]">
      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          upload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {url ? (
        <div
          className={
            dark
              ? 'h-[96px] rounded-[10px] border border-newTableBorder bg-black flex items-center justify-center p-[10px]'
              : 'h-[96px] rounded-[10px] border border-newTableBorder bg-white flex items-center justify-center p-[10px]'
          }
        >
          <img
            src={resolve(url)}
            alt={label}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      ) : (
        <div className="h-[96px] rounded-[10px] border border-dashed border-newTableBorder flex flex-col items-center justify-center gap-[4px]">
          {uploading ? (
            <span className="text-[12px] text-textItemBlur">
              {t('brief_asset_uploading', 'Uploading...')}
            </span>
          ) : (
            <>
              <span className={link} onClick={() => picker.current?.click()}>
                {t('brief_kit_logo_upload', 'Upload')}
              </span>
              <span className={link} onClick={fromLibrary}>
                {t('brief_kit_logo_library', 'From library')}
              </span>
            </>
          )}
        </div>
      )}
      <div className="flex items-center gap-[10px]">
        <span className="flex-1 text-[12px] text-textItemBlur">{label}</span>
        {!!url && (
          <>
            <span className={link} onClick={() => picker.current?.click()}>
              {t('brief_kit_logo_replace', 'Replace')}
            </span>
            <span className={link} onClick={() => onChange(undefined)}>
              {t('brief_kit_remove', 'Remove')}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

// Branding & assets as values: colours by role, Google Fonts by role, the
// logo for light and dark backgrounds, and a line on imagery. Every change
// sends the whole kit (it is small) through the document's autosave.
export const BriefBrandKit: FC<{
  kit?: BriefKit;
  blocks: BriefBlock[];
  assets: BriefAsset[];
  onChange: (kit: BriefKit) => void;
}> = ({ kit, blocks, assets, onChange }) => {
  const t = useT();
  const classic = useBriefClassic();
  const resolve = useBriefFileUrl();
  const user = useUser();
  const [current, setCurrent] = useState<BriefKit>(kit || {});
  const [extraColors, setExtraColors] = useState<BriefKitColorRole[]>([]);
  const [addingColor, setAddingColor] = useState(false);
  const [showIcon, setShowIcon] = useState(false);
  const [dismissed, setDismissed] = useState(() => readDismissed(user?.orgId));

  const update = useCallback(
    (next: BriefKit) => {
      setCurrent(next);
      onChange(complete(next));
    },
    [onChange]
  );

  const roleLabel = useCallback(
    (role: string) =>
      ({
        primary: t('brief_kit_color_primary', 'Primary'),
        secondary: t('brief_kit_color_secondary', 'Secondary'),
        accent: t('brief_kit_color_accent', 'Accent'),
        background: t('brief_kit_color_background', 'Background'),
        text: t('brief_kit_color_text', 'Text'),
        muted: t('brief_kit_color_muted', 'Muted'),
        surface: t('brief_kit_color_surface', 'Surface'),
        headline: t('brief_kit_font_headline', 'Headline'),
        body: t('brief_kit_font_body', 'Body'),
        light: t('brief_kit_logo_light', 'On light backgrounds'),
        dark: t('brief_kit_logo_dark', 'On dark backgrounds'),
        icon: t('brief_kit_logo_icon', 'Icon'),
      }[role] || role),
    [t]
  );

  const setColor = useCallback(
    (role: BriefKitColorRole) => (hex?: string) =>
      update({
        ...current,
        colors: BRIEF_KIT_COLOR_ROLES.flatMap((one) => {
          const value =
            one === role
              ? hex
              : current.colors?.find((color) => color.role === one)?.hex;
          return value ? [{ role: one, hex: value }] : [];
        }),
      }),
    [current, update]
  );

  const setFont = useCallback(
    (role: BriefKitFontRole) => (family?: string) =>
      update({
        ...current,
        fonts: BRIEF_KIT_FONT_ROLES.flatMap((one) => {
          const value =
            one === role
              ? family
              : current.fonts?.find((font) => font.role === one)?.family;
          return value ? [{ role: one, family: value }] : [];
        }),
      }),
    [current, update]
  );

  const setLogo = useCallback(
    (variant: BriefKitLogoVariant) => (url?: string) =>
      update({
        ...current,
        logos: BRIEF_KIT_LOGO_VARIANTS.flatMap((one) => {
          const value =
            one === variant
              ? url
              : current.logos?.find((logo) => logo.variant === one)?.url;
          return value ? [{ variant: one, url: value }] : [];
        }),
      }),
    [current, update]
  );

  const colorOf = (role: string) =>
    current.colors?.find((color) => color.role === role)?.hex;
  const fontOf = (role: string) =>
    current.fonts?.find((font) => font.role === role)?.family;
  const logoOf = (variant: string) =>
    current.logos?.find((logo) => logo.variant === variant)?.url;

  const shownColors = BRIEF_KIT_COLOR_ROLES.filter(
    (role) =>
      CORE_COLORS.includes(role) ||
      !!colorOf(role) ||
      extraColors.includes(role)
  );
  const hiddenColors = BRIEF_KIT_COLOR_ROLES.filter(
    (role) => !shownColors.includes(role)
  );

  const suggestion = useMemo(
    () => (isKitEmpty(current) ? suggestKit(blocks, assets) : {}),
    [current, blocks, assets]
  );
  const suggesting = !dismissed && !isKitEmpty(suggestion);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedKey(user?.orgId), '1');
    } catch {
      // Not remembered; it comes back on the next visit.
    }
  }, [user?.orgId]);

  const chip = classic
    ? 'cursor-pointer select-none rounded-[8px] border border-dashed border-newTableBorder px-[10px] h-[30px] flex items-center text-[13px] text-textItemBlur hover:border-warm hover:text-warm hover:bg-warmHover transition-colors'
    : 'cursor-pointer select-none rounded-[8px] border border-dashed border-newTableBorder px-[10px] h-[30px] flex items-center text-[13px] text-textItemBlur hover:border-tealText hover:text-tealText hover:bg-tealHover transition-colors';

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="text-[18px] font-[600]">
        {t('brief_kit_title', 'Brand kit')}
      </div>

      {suggesting && (
        <div
          className={
            classic
              ? 'flex flex-col gap-[12px] rounded-[10px] border border-warm p-[14px]'
              : 'flex flex-col gap-[12px] rounded-[10px] border border-tealText p-[14px]'
          }
        >
          <div className="text-[14px] font-[600]">
            {t('brief_kit_suggest_title', 'Fill these from your notes')}
          </div>
          <div className="flex flex-wrap gap-[14px] text-[13px]">
            {suggestion.colors?.map((color) => (
              <div key={color.role} className="flex items-center gap-[6px]">
                <span
                  className="w-[16px] h-[16px] rounded-full border border-newTableBorder"
                  style={{ backgroundColor: color.hex }}
                />
                {roleLabel(color.role)} {color.hex}
              </div>
            ))}
            {suggestion.fonts?.map((font) => (
              <div key={font.role}>
                {roleLabel(font.role)}: {font.family}
              </div>
            ))}
            {suggestion.logos?.map((logo) => (
              <div key={logo.variant} className="flex items-center gap-[6px]">
                <img
                  src={resolve(logo.url)}
                  alt={roleLabel(logo.variant)}
                  className="w-[24px] h-[24px] object-contain"
                />
                {roleLabel(logo.variant)}
              </div>
            ))}
          </div>
          {!!suggestion.imagery && (
            <div className="text-[13px] text-textItemBlur">
              {suggestion.imagery}
            </div>
          )}
          <div className="flex items-center gap-[10px]">
            <div
              onClick={() => update(suggestion)}
              className={
                classic
                  ? 'cursor-pointer select-none rounded-[8px] border border-warm px-[14px] h-[34px] flex items-center text-[14px] text-warm hover:bg-warmHover transition-colors'
                  : 'cursor-pointer select-none rounded-[8px] border border-tealText px-[14px] h-[34px] flex items-center text-[14px] text-tealText hover:bg-tealHover transition-colors'
              }
            >
              {t('brief_kit_suggest_use', 'Use these')}
            </div>
            <div
              onClick={dismiss}
              className="cursor-pointer select-none px-[10px] h-[34px] flex items-center text-[14px] text-textItemBlur hover:text-textColor transition-colors"
            >
              {t('brief_kit_suggest_dismiss', 'Not now')}
            </div>
          </div>
        </div>
      )}

      <Section
        label={t('brief_kit_colors', 'Colours')}
        caption={t(
          'brief_kit_colors_caption',
          'Used for slides, thumbnails and videos.'
        )}
      >
        <div className="flex flex-wrap items-start gap-[8px]">
          {shownColors.map((role) => (
            <ColorSwatch
              key={role}
              role={role}
              label={roleLabel(role)}
              hex={colorOf(role)}
              removable={!!colorOf(role)}
              onChange={setColor(role)}
            />
          ))}
          {!!hiddenColors.length && (
            <div className="flex flex-col gap-[6px] pt-[8px]">
              {addingColor ? (
                <div className="flex flex-wrap gap-[6px]">
                  {hiddenColors.map((role) => (
                    <div
                      key={role}
                      className={chip}
                      onClick={() => {
                        setExtraColors([...extraColors, role]);
                        setAddingColor(false);
                      }}
                    >
                      {roleLabel(role)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={chip} onClick={() => setAddingColor(true)}>
                  {t('brief_kit_add_color', '+ Add colour')}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section
        label={t('brief_kit_fonts', 'Fonts')}
        caption={t(
          'brief_kit_fonts_caption',
          'Google Fonts families for headlines and body text on slides and thumbnails.'
        )}
      >
        <datalist id={FONTS_LIST_ID}>
          {GOOGLE_FONT_FAMILIES.map((family) => (
            <option key={family} value={family} />
          ))}
        </datalist>
        {BRIEF_KIT_FONT_ROLES.map((role) => (
          <FontPicker
            key={role}
            label={roleLabel(role)}
            family={fontOf(role)}
            onChange={setFont(role)}
          />
        ))}
      </Section>

      <Section
        label={t('brief_kit_logo', 'Logo')}
        caption={t(
          'brief_kit_logo_caption',
          'Placed on slides, thumbnails and videos.'
        )}
      >
        <div className="flex flex-wrap items-start gap-[12px]">
          {BRIEF_KIT_LOGO_VARIANTS.filter(
            (variant) => variant !== 'icon' || showIcon || !!logoOf('icon')
          ).map((variant) => (
            <LogoSlot
              key={variant}
              label={roleLabel(variant)}
              dark={variant === 'dark'}
              url={logoOf(variant)}
              onChange={setLogo(variant)}
            />
          ))}
          {!showIcon && !logoOf('icon') && (
            <div className={chip} onClick={() => setShowIcon(true)}>
              {t('brief_kit_add_icon', '+ Icon')}
            </div>
          )}
        </div>
      </Section>

      <Section
        label={t('brief_kit_imagery', 'Imagery')}
        caption={t(
          'brief_kit_imagery_caption',
          'How photos and illustrations look, in one line.'
        )}
      >
        <input
          value={current.imagery || ''}
          maxLength={BRIEF_KIT_IMAGERY_MAX}
          dir="auto"
          aria-label={t('brief_kit_imagery', 'Imagery')}
          onChange={(event) =>
            update({ ...current, imagery: event.target.value })
          }
          placeholder={t(
            'brief_kit_imagery_placeholder',
            'One line: e.g. warm candid photos of real customers, no stock, no illustration'
          )}
          className="w-full bg-transparent outline-none rounded-[8px] border border-newTableBorder px-[10px] h-[36px] text-[14px] placeholder:text-textItemBlur"
        />
      </Section>
    </div>
  );
};
