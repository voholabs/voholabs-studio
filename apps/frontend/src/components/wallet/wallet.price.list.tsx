'use client';

import React, { FC, ReactNode, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useWalletFormat } from '@gitroom/frontend/components/wallet/wallet.hooks';
import { ENABLED_PROVIDERS } from '@gitroom/frontend/components/launches/enabled.providers';
import {
  actionDescription,
  actionName,
  sectionLabel,
  tAllowance,
  titleCase,
  tModel,
  tMonthly,
  tPrice,
} from '@gitroom/frontend/components/wallet/wallet.text';
import {
  SupportedChannel,
  WalletPriceSection,
  WalletPricedAction,
} from '@gitroom/frontend/components/wallet/wallet.types';
import {
  CARD,
  CoinsIcon,
  InfoTip,
  PILL,
  POS_BG,
  POS_SOFT,
  POS_TEXT,
  ProviderLogo,
  SCROLL,
  sectionIcon,
} from '@gitroom/frontend/components/wallet/wallet.ui';

// The price list, generated only from the price rows (GET /wallet/prices, or
// GET /public/prices on the public page): no per-row copy. Shared by the
// in-app Prices page and the public /pricing page.

// The section that lists channels also gets a computed row for every
// supported channel without a priced action: those are free.
const CHANNELS_SECTION = 'channels';

export interface Row {
  key: string;
  icon: ReactNode;
  name: string;
  description: string;
  model: string;
  free: boolean;
  allowance: string;
  price: string;
  info: string | null;
}

const Pill: FC<{ free: boolean; label: string }> = ({ free, label }) =>
  free ? (
    <span className={clsx(PILL, POS_SOFT, POS_TEXT)}>{label}</span>
  ) : (
    <span className={clsx(PILL, 'gap-[5px] bg-warmSoft text-warm')}>
      <CoinsIcon size={11} /> {label}
    </span>
  );

// A round avatar with the section's icon, for a row that is not a channel
// (storage, brief, skills), the same size as a channel logo.
const SectionAvatar: FC<{ section: string; size?: number }> = ({
  section,
  size = 20,
}) => (
  <span
    aria-hidden="true"
    className="rounded-full shrink-0 bg-newBgLineColor text-textItemBlur flex items-center justify-center [&_svg]:w-[60%] [&_svg]:h-[60%]"
    style={{ width: size, height: size }}
  >
    {sectionIcon(section)}
  </span>
);

// A row's icon: the platform logo for a channel, otherwise (or when the logo
// fails to load) the section icon. Never a broken image.
const RowIcon: FC<{ provider: string; section: string; channel: boolean }> = ({
  provider,
  section,
  channel,
}) => {
  const [failed, setFailed] = useState(false);
  if (!channel || failed) return <SectionAvatar section={section} />;
  return (
    <img
      src={
        provider === 'youtube'
          ? '/icons/platforms/youtube.svg'
          : `/icons/platforms/${provider}.png`
      }
      alt=""
      width={20}
      height={20}
      className="rounded-full shrink-0 object-cover"
      style={{ width: 20, height: 20 }}
      onError={() => setFailed(true)}
    />
  );
};

const IconStack: FC<{ providers: string[] }> = ({ providers }) => (
  <div className="flex items-center shrink-0">
    {providers.slice(0, 3).map((p, n) => (
      <span
        key={p}
        className={clsx(
          'relative w-[22px] h-[22px] rounded-full overflow-hidden ring-2 ring-[var(--new-bgColorInner)] bg-white flex items-center justify-center',
          n > 0 && '-ms-[6px]'
        )}
        style={{ zIndex: 3 - n }}
      >
        <ProviderLogo provider={p} size={22} />
      </span>
    ))}
  </div>
);

// A channel's display name without the variant in brackets
// ("Instagram\n(Standalone)" -> "Instagram").
const channelName = (c: SupportedChannel) =>
  c.name.replace(/\n\([\s\S]*\)/, '').trim();

// "X", "X and Bluesky", "X, Bluesky and Reddit" in the page language.
// Intl.ListFormat is missing from this TypeScript lib, hence the cast.
type ListFormat = new (
  locale: string,
  options: { style: string; type: string }
) => { format: (items: string[]) => string };

const listOf = (locale: string, items: string[]) => {
  try {
    const List = (Intl as unknown as { ListFormat: ListFormat }).ListFormat;
    return new List(locale, { style: 'long', type: 'conjunction' }).format(
      items
    );
  } catch {
    return items.join(', ');
  }
};

// The row for every supported channel without a price row: "All channels
// excluding X". The excluded names are the providers that have a price row
// in this section, so a newly priced channel is excluded without new copy.
export const freeChannelsRow = (
  t: ReturnType<typeof useT>,
  locale: string,
  section: WalletPriceSection,
  channels: SupportedChannel[]
): Row | null => {
  const priced = [
    ...new Set(
      section.actions.map((a) => a.provider).filter((p): p is string => !!p)
    ),
  ];
  const free = channels.filter((c) => !priced.includes(c.identifier));
  if (!free.length) return null;
  const names = [...new Set(free.map(channelName))];
  const excluded = [
    ...new Set(
      priced.map((id) => {
        const channel = channels.find((c) => c.identifier === id);
        return channel ? channelName(channel) : titleCase(id);
      })
    ),
  ];
  // One logo per provider family (linkedin and linkedin-page share one).
  const families = [
    ...new Map(
      free.map((c) => [c.identifier.split('-')[0], c.identifier])
    ).values(),
  ];
  return {
    key: 'all-other-channels',
    icon: <IconStack providers={families} />,
    name: excluded.length
      ? t('wallet_all_channels_excluding', 'All channels excluding {{names}}', {
          names: listOf(locale, excluded),
          interpolation: { escapeValue: false },
        })
      : t('wallet_all_channels', 'All channels'),
    description: names.join(', '),
    model: t('wallet_model_free', 'Free'),
    free: true,
    allowance: t('wallet_allowance_unlimited', 'Unlimited use'),
    price: t('wallet_price_free', 'Free'),
    info: null,
  };
};

export const PriceTable: FC<{ rows: Row[] }> = ({ rows }) => {
  const t = useT();
  return (
    <div className={clsx('overflow-x-auto', SCROLL)}>
      <table className="w-full min-w-[680px] text-[14px] table-fixed">
        <thead>
          <tr className="bg-newTableHeader text-[12px] text-textItemBlur h-[36px]">
            <th className="text-start font-[500] px-[20px] w-[36%]">
              {t('wallet_col_item', 'Item')}
            </th>
            <th className="text-start font-[500] px-[20px]">
              {t('wallet_col_pricing', 'Pricing')}
            </th>
            <th className="text-start font-[500] px-[20px]">
              {t('wallet_col_included', 'Included free')}
            </th>
            <th className="text-end font-[500] px-[20px] w-[200px]">
              {t('wallet_col_price', 'Price')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className="border-t border-newTableBorder h-[60px] hover:bg-boxHover"
            >
              <td className="px-[20px] py-[10px]">
                <div className="flex items-center gap-[10px]">
                  {r.icon}
                  <div className="min-w-0">
                    <div className="font-[600] flex items-center gap-[6px]">
                      <span>{r.name}</span>
                      {!!r.info && (
                        <InfoTip text={r.info} className="font-[500]" />
                      )}
                    </div>
                    {!!r.description && (
                      <div className="text-[12px] text-textItemBlur">
                        {r.description}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-[20px]">
                <Pill free={r.free} label={r.model} />
              </td>
              <td
                className={clsx(
                  'px-[20px]',
                  r.allowance ? POS_TEXT : 'text-textItemBlur'
                )}
              >
                {r.allowance || t('wallet_allowance_none', 'None')}
              </td>
              <td className="px-[20px] text-end">
                <span
                  className={clsx(
                    'font-[600] whitespace-nowrap',
                    r.free ? POS_TEXT : 'tabular-nums'
                  )}
                >
                  {r.price}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Category links, the Free / Pay-per-use legend and one card per section.
// The channels section starts with the computed free-channels row.
export const PriceList: FC<{
  sections: WalletPriceSection[];
  channels?: SupportedChannel[];
  currency?: string;
}> = ({ sections, channels, currency }) => {
  const t = useT();
  const f = useWalletFormat(currency);

  const rendered = useMemo(
    () =>
      sections.map((section) => {
        const rows: Row[] = section.actions.map((a: WalletPricedAction) => ({
          key: a.key,
          icon: a.provider ? (
            <RowIcon
              provider={a.provider}
              section={section.key}
              channel={
                ENABLED_PROVIDERS.includes(a.provider) ||
                !!channels?.some((c) => c.identifier === a.provider)
              }
            />
          ) : null,
          name: actionName(t, a),
          description: actionDescription(t, a),
          model: tModel(t, a),
          free: a.billing === 'UNLOCK',
          allowance: tAllowance(t, a),
          price: tPrice(t, f, a),
          info: a.billing === 'MONTHLY' ? tMonthly(t, f, a) : null,
        }));
        if (section.key === CHANNELS_SECTION && channels) {
          const free = freeChannelsRow(t, f.locale, section, channels);
          if (free) rows.unshift(free);
        }
        return { key: section.key, label: sectionLabel(t, section.key), rows };
      }),
    [sections, channels, t, f]
  );

  return (
    <>
      <div
        className="flex items-center gap-[8px] flex-wrap"
        role="navigation"
        aria-label={t('wallet_price_categories', 'Price categories')}
      >
        {rendered.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() =>
              document
                .getElementById(`wallet-prices-${s.key}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            className="h-[32px] px-[12px] rounded-[8px] border border-newTableBorder text-[13px] text-textItemBlur hover:text-newTextColor hover:border-newSep"
          >
            {s.label}
          </button>
        ))}
        <span className="flex-1" />
        <span className="flex items-center gap-[14px] text-[12px] text-textItemBlur">
          <span className="flex items-center gap-[6px]">
            <span className={clsx('w-[8px] h-[8px] rounded-full', POS_BG)} />
            {t('wallet_legend_free', 'Free')}
          </span>
          <span className="flex items-center gap-[6px]">
            <span className="text-warm">
              <CoinsIcon size={12} />
            </span>
            {t('wallet_legend_pay_per_use', 'Pay-per-use')}
          </span>
        </span>
      </div>
      {rendered.map((s) => (
        <section
          key={s.key}
          id={`wallet-prices-${s.key}`}
          className={clsx(CARD, 'overflow-hidden scroll-mt-[20px] min-w-0')}
        >
          <div className="flex items-center gap-[12px] px-[20px] py-[16px]">
            <div className="w-[36px] h-[36px] rounded-[8px] bg-newBgLineColor flex items-center justify-center text-textItemBlur">
              {sectionIcon(s.key)}
            </div>
            <h2 className="flex-1 text-[16px] font-[600]">{s.label}</h2>
          </div>
          <PriceTable rows={s.rows} />
        </section>
      ))}
    </>
  );
};
