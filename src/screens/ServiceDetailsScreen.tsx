import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SIZES, BORDER_RADIUS } from '../constants/colors';
import { STRINGS } from '../constants/strings';
import { getServiceById, getB2BReadiness } from '../services/api';

interface Navigation {
  navigate: (route: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
  replace?: (route: string) => void;
  addListener?: (event: string, cb: () => void) => () => void;
}

interface Route {
  params?: { [key: string]: any };
}

interface Props {
  navigation: Navigation;
  route: Route;
}

const ServiceDetailsScreen: React.FC<Props> = ({ navigation, route }) => {
  // Pull safe-area insets so the fixed bottom CTA (Book Now / Request
  // Quote) doesn't get clipped by the gesture bar, home indicator, or
  // rounded screen edges on modern phones.
  const insets = useSafeAreaInsets();
  const { serviceId } = route.params as { serviceId: any };

  // Service detail fetched + cached by TanStack Query, keyed on the
  // serviceId so each service has its own cache entry.
  const {
    data: rawService,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['service', serviceId],
    queryFn: async () => {
      const response: any = await getServiceById(serviceId);
      return response.data;
    },
    enabled: serviceId != null,
  });
  const error = queryError
    ? ((queryError as any)?.message || STRINGS.ERROR_LOADING_SERVICE_DETAILS)
    : null;

  // Rate-chart safety override — same idea as in BookingScreen. If the
  // backend service row is missing partner_earning / company_margin /
  // total_expense (older seed) we patch them client-side so the
  // breakdown card still renders correct numbers. Reads off the same
  // canonical rate-chart values; never overrides anything the backend
  // already provided non-zero.
  const RATE_CHART_OVERRIDES: Array<{
    category: RegExp; name: RegExp;
    user_cost: number; govt_fees: number; partner_earning: number;
    total_expense: number; company_margin: number; expected_timeline: string;
  }> = [
    { category: /aadhaar|aadhar/i, name: /new\s+aadhaar\s+enrolment/i, user_cost:  200, govt_fees:    0, partner_earning: 100, total_expense:  100, company_margin: 100, expected_timeline: '1 week'  },
    { category: /aadhaar|aadhar/i, name: /husband\s+name\s+update/i,    user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '3 weeks' },
    { category: /aadhaar|aadhar/i, name: /address\s+update/i,           user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '4 weeks' },
    { category: /aadhaar|aadhar/i, name: /date\s+of\s+birth/i,          user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '5 weeks' },
    { category: /aadhaar|aadhar/i, name: /gender\s+update/i,            user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '6 weeks' },
    { category: /aadhaar|aadhar/i, name: /biometric/i,                  user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '7 weeks' },
    { category: /aadhaar|aadhar/i, name: /mobile\s*no\.?\s+update/i,    user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '8 weeks' },
    { category: /aadhaar|aadhar/i, name: /email\s+id\s+update/i,        user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '9 weeks' },
    { category: /aadhaar|aadhar/i, name: /order\s+aadhaar\s+pvc/i,      user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '10 weeks' },
    { category: /aadhaar|aadhar/i, name: /download\s+aadhaar/i,         user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '11 weeks' },
    { category: /aadhaar|aadhar/i, name: /verify\s+email\/?mobile/i,    user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '12 weeks' },
    { category: /aadhaar|aadhar/i, name: /name\s+update/i,              user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '2 weeks' },
    { category: /pan/i, name: /link\s+pan\s+to\s+aadhaar/i,             user_cost: 1100, govt_fees: 1000, partner_earning:  75, total_expense: 1075, company_margin:  25, expected_timeline: '48-72 hrs' },
    { category: /pan/i, name: /new\s+pan/i,                             user_cost:  220, govt_fees:  107, partner_earning:  75, total_expense:  182, company_margin:  38, expected_timeline: '24-48 hrs' },
    { category: /pan/i, name: /(name|address|date\s+of\s+birth|gender|mobile|email|order|download|verify)/i, user_cost: 220, govt_fees: 107, partner_earning: 75, total_expense: 182, company_margin: 38, expected_timeline: '48-72 hrs' },
    { category: /voter|epic|electoral/i, name: /.*/i,                   user_cost:  150, govt_fees:    0, partner_earning: 100, total_expense:  100, company_margin:  50, expected_timeline: '10-15 Days' },
    { category: /ration|pds/i,           name: /.*/i,                   user_cost:  150, govt_fees:    0, partner_earning: 100, total_expense:  100, company_margin:  50, expected_timeline: '20-30 Days' },
    // Driving Licence — per 09.04.26 rate chart. More-specific names
    // sit first so e.g. "Driving Licence Heavy" hits the heavy row
    // before the generic 4-wheeler one.
    { category: /driving|licen[cs]e|\bdl\b/i, name: /learner.?licen/i,            user_cost:  5000, govt_fees:  4000, partner_earning:  500, total_expense:  4500, company_margin:  500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /heavy/i,                     user_cost: 22000, govt_fees: 19000, partner_earning: 2000, total_expense: 21000, company_margin: 1000, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /renewal/i,                   user_cost:  3500, govt_fees:  2500, partner_earning:  500, total_expense:  3000, company_margin:  500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /(2.?wheeler|two.?wheeler)/i, user_cost: 4500, govt_fees: 4000, partner_earning:  500, total_expense:  4500, company_margin:    0, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /(4.?wheeler|four.?wheeler)/i, user_cost: 5000, govt_fees: 4000, partner_earning:  500, total_expense:  4500, company_margin:  500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /duplicate/i,                 user_cost:  1500, govt_fees:  1000, partner_earning:  300, total_expense:  1300, company_margin:  200, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /change.?of.?address|address.?change/i, user_cost: 1500, govt_fees: 800, partner_earning: 500, total_expense: 1300, company_margin: 200, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /international|idp/i,         user_cost:  5000, govt_fees:  3500, partner_earning: 1000, total_expense:  4500, company_margin:  500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /add.?class|class.?of.?vehicle/i, user_cost: 5000, govt_fees: 4000, partner_earning: 500, total_expense: 4500, company_margin: 500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /(ll.?test|stall)/i,          user_cost:   800, govt_fees:   500, partner_earning:  200, total_expense:   700, company_margin:  100, expected_timeline: '5-10 Days' },
    // Other services — per rate chart, all timelines are "5-12 Hrs".
    { category: /msme|udhyog|udyog/i,           name: /.*/i, user_cost:  300, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 200, expected_timeline: '5-12 Hrs' },
    { category: /food.?license|fssai/i,         name: /.*/i, user_cost:  200, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 100, expected_timeline: '5-12 Hrs' },
    { category: /trade.?license/i,              name: /.*/i, user_cost: 1000, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 900, expected_timeline: '5-12 Hrs' },
    { category: /caste/i,                       name: /.*/i, user_cost:  300, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 200, expected_timeline: '5-12 Hrs' },
    { category: /domicile/i,                    name: /.*/i, user_cost:  400, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 300, expected_timeline: '5-12 Hrs' },
    { category: /income/i,                      name: /.*/i, user_cost:  250, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 150, expected_timeline: '5-12 Hrs' },
    { category: /birth.?certificate/i,          name: /.*/i, user_cost:  400, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 300, expected_timeline: '5-12 Hrs' },
    { category: /death.?certificate/i,          name: /.*/i, user_cost:  400, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 300, expected_timeline: '5-12 Hrs' },
    { category: /life.?certificate/i,           name: /.*/i, user_cost:   50, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: -50, expected_timeline: '5-12 Hrs' },
  ];

  const applyRateChartOverride = (svc: any): any => {
    if (!svc?.name || !svc?.category) return svc;
    const hit = RATE_CHART_OVERRIDES.find(
      (r) => r.category.test(String(svc.category)) && r.name.test(String(svc.name)),
    );
    if (!hit) return svc;
    // Treat "Instant" / "Quick" / "N/A" / empty as missing — backend
    // seed had these placeholder strings for many rows, which leaked
    // into the customer-facing Expected Timeline. When a rate-chart
    // row matches we always prefer ITS timeline string (canonical from
    // the PDF). Numeric fields still defer to DB values when set.
    const placeholder = /^(instant|quick|n\/?a|tbd|varies|—|-)$/i;
    const dbTimeline = String(svc.expected_timeline || '').trim();
    const useDbTimeline = !!dbTimeline && !placeholder.test(dbTimeline);
    return {
      ...svc,
      user_cost:        Number(svc.user_cost) || hit.user_cost,
      govt_fees:        svc.govt_fees != null ? Number(svc.govt_fees) : hit.govt_fees,
      partner_earning:  Number(svc.partner_earning) || hit.partner_earning,
      company_margin:   Number(svc.company_margin) || hit.company_margin,
      total_expense:    Number(svc.total_expense) || hit.total_expense,
      expected_timeline: useDbTimeline ? dbTimeline : hit.expected_timeline,
    };
  };

  // The query returns the raw service row; the rate-chart override is
  // applied here so the breakdown card always has correct numbers.
  const service = useMemo(
    () => (rawService ? applyRateChartOverride(rawService) : null),
    // applyRateChartOverride is pure (no external deps) — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawService],
  );

  const handleRetry = (): void => {
    refetch();
  };

  // Two distinct paths:
  //   • Fixed-price (consumer) → classic Booking flow.
  //   • Quote-based (industrial) → Company Profile + NDA gate, then Enquiry.
  const handleBookNow = async (): Promise<void> => {
    if (!service) return;

    const isQuoteBased = service.pricing_model === 'quote';

    if (!isQuoteBased) {
      navigation.navigate('Booking', { serviceData: service });
      return;
    }

    // Quote-based — gate on Company Profile + NDA
    try {
      const res: any = await getB2BReadiness();
      const { profile_complete, nda_accepted } = res?.data || {};

      if (!profile_complete) {
        Alert.alert(
          'Company Profile Required',
          'Industrial services need your company details (GSTIN, PAN, Point of Contact, etc.) before we can raise an enquiry.',
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Fill Profile',
              onPress: () => navigation.navigate('CompanyProfile', { afterSave: 'nda' }),
            },
          ]
        );
        return;
      }
      if (!nda_accepted) {
        Alert.alert(
          'Digital NDA Required',
          'Please review and accept our Non-Disclosure Agreement before submitting an industrial enquiry.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Review NDA', onPress: () => navigation.navigate('NDA') },
          ]
        );
        return;
      }
    } catch (e: any) {
      // Fail-open if readiness endpoint is unreachable — the Enquiry API
      // itself re-validates server-side (profile + NDA) so we won't create
      // bad data either way.
      console.log('B2B readiness check failed:', e?.message);
    }

    navigation.navigate('Enquiry', { service });
  };

  const renderLoadingState = () => (
    <View style={styles.loadingState}>
      <ActivityIndicator size="large" color={COLORS.PRIMARY} />
      <Text style={styles.loadingText}>Loading service details...</Text>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.errorState}>
      <Text style={styles.errorTitle}>Failed to Load Service Details</Text>
      <Text style={styles.errorMessage}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  const renderServiceDetails = () => {
    if (!service) return null;

    // Quote-based services (industrial) don't have catalog pricing or fixed
    // timelines — we show a Request Quote CTA instead.
    const isQuoteBased = service.pricing_model === 'quote';

    return (
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        // Bottom space matches the height of the fixed Book Now / Request
        // Quote container so the last bit of service detail isn't hidden
        // behind it. Insets get added on top because the container itself
        // already pads for them.
        contentContainerStyle={{ paddingBottom: 96 + (insets.bottom || 0) }}
      >
        <View style={styles.content}>
          {/* Service Name */}
          <Text style={styles.serviceName}>{service.name}</Text>

          {/* Category Badge */}
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{service.category}</Text>
          </View>

          {isQuoteBased ? (
            // ─── Quote-based panel (industrial) ─────────────────────────
            <View style={styles.quoteContainer}>
              <Text style={styles.quoteBadge}>CUSTOM QUOTE · B2B</Text>

              {/* Indicative price — populated from Service.indicative_price_from/to
                  + pricing_unit by the backend. Falls back to a generic label
                  if no range has been configured for this service yet. */}
              {service.indicative_price_from ? (
                <>
                  <Text style={styles.quoteHeadline}>
                    {service.indicative_price_to && Number(service.indicative_price_to) !== Number(service.indicative_price_from)
                      ? `₹${Number(service.indicative_price_from).toLocaleString('en-IN')} – ₹${Number(service.indicative_price_to).toLocaleString('en-IN')}`
                      : `Starting at ₹${Number(service.indicative_price_from).toLocaleString('en-IN')}`}
                    {service.pricing_unit && service.pricing_unit !== 'one_time' ? (
                      <Text style={styles.quoteUnit}>
                        {' '}/ {service.pricing_unit.replace('per_', '').replace('_', ' ')}
                      </Text>
                    ) : null}
                  </Text>
                  <Text style={styles.quoteSubhead}>Professional fee range (government fees extra)</Text>
                </>
              ) : (
                <Text style={styles.quoteHeadline}>Price & timeline on quote</Text>
              )}

              {/* Timeline — from Service.expected_timeline */}
              {!!service.expected_timeline && (
                <View style={styles.quoteMetaRow}>
                  <Text style={styles.quoteMetaLabel}>Timeline</Text>
                  <Text style={styles.quoteMetaValue}>{service.expected_timeline}</Text>
                </View>
              )}

              <Text style={styles.quoteBody}>
                Submit an enquiry and a FliponeX Digital expert will share a detailed
                quote within 24 business hours. No charges until you accept the quote.
              </Text>

              {/* Terms & conditions — from the rate chart footer */}
              <View style={styles.quoteTermsBlock}>
                <Text style={styles.quoteTermsTitle}>Billing & Terms</Text>
                <Text style={styles.quoteTermsItem}>• 50% advance for fresh registrations; 100% on completion for recurring filings</Text>
                <Text style={styles.quoteTermsItem}>• Government fees / challans are extra, as per actuals</Text>
                <Text style={styles.quoteTermsItem}>• Urgent (24-hour) completion = 25% surcharge on the professional fee</Text>
                <Text style={styles.quoteTermsItem}>• Industrial-zone visit fee ₹300 – ₹500 if total service value is below ₹2,000</Text>
                <Text style={styles.quoteTermsItem}>• Covered by FliponeX NDA — all documents handled via secure transit</Text>
              </View>
            </View>
          ) : (
            <>
              {/* Pricing — single line. Customer pays `user_cost`
                  (the rate-chart customer price). The internal split
                  (govt + partner + company margin) is intentionally
                  hidden — it lives in the admin dashboard and on the
                  booking payload for commission accounting only. */}
              {(() => {
                // user_cost is the canonical customer price. If a stale
                // service row is missing it, fall back to total_expense
                // → indicative_price_from so the customer still sees a
                // number rather than ₹0.
                const userCost =
                  Number(service.user_cost) ||
                  Number(service.total_expense) ||
                  Number(service.indicative_price_from) ||
                  0;
                return (
                  <View style={styles.pricingContainer}>
                    <Text style={styles.sectionTitle}>Pricing</Text>
                    <View style={[styles.pricingRow, styles.totalRow]}>
                      <Text style={styles.totalLabel}>Total Payable</Text>
                      <Text style={styles.totalValue}>₹ {userCost}</Text>
                    </View>
                  </View>
                );
              })()}

              {/* Timeline section — three rows. The backend only
                  carries `expected_timeline` today; processing fees and
                  expected delivery aren't tracked per-service yet, so
                  they render as "N/A" placeholders. The earlier "?"
                  prefix was a missing Unicode icon — now plain labels
                  so nothing ever shows a stray glyph. */}
              <View style={styles.timelineContainer}>
                <Text style={styles.sectionTitle}>Expected Timeline</Text>
                <View style={styles.timelineRow}>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineLabel}>Expected timeline</Text>
                    <Text style={styles.timelineValue}>
                      {service.expected_timeline || 'Varies by service — confirmed on booking.'}
                    </Text>
                  </View>
                </View>
                <View style={styles.timelineRow}>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineLabel}>Processing fees</Text>
                    <Text style={styles.timelineValue}>N/A</Text>
                  </View>
                </View>
                <View style={styles.timelineRow}>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineLabel}>Expected delivery</Text>
                    <Text style={styles.timelineValue}>N/A</Text>
                  </View>
                </View>
              </View>
            </>
          )}

          {/* Checklist — matches the spec's "Please keep ready" wording so
              the customer treats this as a pre-visit preparation list, not
              a generic info dump. Saves the rep time on-site (single-visit
              completion). */}
          {service.required_documents && (
            <View style={styles.documentsContainer}>
              <Text style={styles.sectionTitle}>📋 Please Keep Ready</Text>
              <Text style={{ fontSize: 13, color: '#6C757D', marginBottom: 10, lineHeight: 18 }}>
                Have these handy before the representative visits — it helps
                us complete your service in a single visit.
              </Text>
              {(() => {
                // Backend may return either a plain array or {documents: [...]}
                const raw = service.required_documents;
                const docs: any[] = Array.isArray(raw)
                  ? raw
                  : Array.isArray(raw?.documents)
                  ? raw.documents
                  : Object.entries(raw || {}).map(([k, v]: [string, any]) => ({
                      type: k,
                      label: typeof v === 'string' ? v : v?.label || k,
                    }));
                return docs.map((doc: any, index: number) => {
                  const label = doc?.label || doc?.type || `Document ${index + 1}`;
                  return (
                    <View key={doc?.type || index} style={styles.documentItem}>
                      {/* Bullet instead of the literal "?" — looked like a
                          missing icon to users. */}
                      <Text style={styles.documentBullet}>•</Text>
                      <View style={styles.documentContent}>
                        <Text style={styles.documentTitle}>
                          {String(label).replace(/_/g, ' ')}
                          {doc?.required === false ? ' (Optional)' : ''}
                        </Text>
                      </View>
                    </View>
                  );
                });
              })()}
            </View>
          )}

          {/* Remarks */}
          {service.remarks && (
            <View style={styles.remarksContainer}>
              <Text style={styles.sectionTitle}>Service Remarks</Text>
              <Text style={styles.remarks}>{service.remarks}</Text>
            </View>
          )}

          {/* Description */}
          {service.description && (
            <View style={styles.descriptionContainer}>
              <Text style={styles.sectionTitle}>{STRINGS.DESCRIPTION}</Text>
              <Text style={styles.description}>{service.description}</Text>
            </View>
          )}

          {/* Disclaimer (per spec) — sets expectations about external
              dependencies the customer can't see (govt portals, etc.). */}
          <View style={styles.disclaimerCard}>
            <Text style={styles.disclaimerLabel}>Please Note</Text>
            <Text style={styles.disclaimerText}>
              FliponeX will not be held responsible for delays caused by slow
              government portals or technical issues. Our experts will provide
              full cooperation until the task is completed.
            </Text>
          </View>

          {/* Additional padding for fixed button */}
          <View style={styles.bottomPadding} />
        </View>
      </ScrollView>
    );
  };

  if (loading) {
    return renderLoadingState();
  }

  if (error) {
    return renderErrorState();
  }

  return (
    <View style={styles.mainContainer}>
      {renderServiceDetails()}

      {/* Fixed CTA — label depends on pricing model. Horizontal +
          bottom padding driven by safe-area insets so the button never
          clips against a rounded screen edge or gesture bar. */}
      <View
        style={[
          styles.buttonContainer,
          {
            paddingBottom: SIZES.BASE + (insets.bottom || 0),
            paddingLeft: SIZES.BASE + (insets.left || 0),
            paddingRight: SIZES.BASE + (insets.right || 0),
          },
        ]}
      >
        <TouchableOpacity style={styles.bookButton} onPress={handleBookNow}>
          <Text style={styles.bookButtonText}>
            {service?.pricing_model === 'quote' ? 'Request Quote' : STRINGS.BOOK_NOW}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: SIZES.BASE,
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    marginTop: SIZES.BASE,
  },
  errorState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SIZES.BASE * 2,
  },
  errorTitle: {
    fontSize: SIZES.XLARGE,
    fontWeight: 'bold',
    color: COLORS.STATUS_CANCELLED,
    marginBottom: SIZES.BASE,
  },
  errorMessage: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    textAlign: 'center',
    marginBottom: SIZES.BASE * 2,
  },
  retryButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: BORDER_RADIUS.MEDIUM,
    paddingHorizontal: SIZES.BASE * 2,
    paddingVertical: SIZES.BASE,
  },
  retryButtonText: {
    color: COLORS.WHITE,
    fontSize: SIZES.FONT,
    fontWeight: 'bold',
  },
  serviceName: {
    fontSize: SIZES.XXLARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE,
  },
  categoryBadge: {
    backgroundColor: COLORS.LIGHT_GRAY,
    borderRadius: BORDER_RADIUS.LARGE,
    paddingHorizontal: SIZES.BASE,
    paddingVertical: SIZES.BASE / 2,
    alignSelf: 'flex-start',
    marginBottom: SIZES.BASE * 2,
  },
  categoryText: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    fontWeight: '600',
  },
  // ─── Quote-based (industrial) panel ───────────────────────────────
  quoteContainer: {
    backgroundColor: '#fff',
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE * 1.25,
    marginBottom: SIZES.BASE,
    borderLeftWidth: 4,
    borderLeftColor: '#1976D2',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  quoteBadge: {
    alignSelf: 'flex-start',
    fontSize: 10, fontWeight: '800', letterSpacing: 0.6,
    color: '#1565C0', backgroundColor: '#E3F2FD',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, marginBottom: 8, overflow: 'hidden',
  },
  quoteHeadline: { fontSize: 20, fontWeight: '800', color: '#0D47A1', marginBottom: 2 },
  quoteUnit: { fontSize: 13, fontWeight: '500', color: '#78909C' },
  quoteSubhead: { fontSize: 11, color: '#78909C', marginBottom: 10 },
  quoteBody: { fontSize: 12, color: '#4A4A4A', lineHeight: 17, marginBottom: 10 },
  quoteBullets: { marginTop: 2 },
  quoteBullet: { fontSize: 12, color: '#333', marginTop: 3, lineHeight: 17 },
  quoteMetaRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: '#E3EAF2', marginTop: 6,
  },
  quoteMetaLabel: { fontSize: 12, color: '#78909C', fontWeight: '600' },
  quoteMetaValue: { fontSize: 12, color: '#263238', fontWeight: '700' },
  quoteTermsBlock: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: '#E3EAF2',
  },
  quoteTermsTitle: { fontSize: 12, fontWeight: '800', color: '#37474F', marginBottom: 6, letterSpacing: 0.3 },
  quoteTermsItem: { fontSize: 11, color: '#546E7A', lineHeight: 16, marginBottom: 3 },
  pricingContainer: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE,
    marginBottom: SIZES.BASE,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SIZES.BASE / 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.LIGHT_GRAY,
  },
  pricingLabel: {
    fontSize: SIZES.FONT,
    color: COLORS.GRAY,
    fontWeight: '500',
  },
  pricingValue: {
    fontSize: SIZES.FONT,
    color: COLORS.BLACK,
    fontWeight: '600',
  },
  totalRow: {
    borderBottomWidth: 0,
    borderTopWidth: 2,
    borderTopColor: COLORS.PRIMARY,
    paddingTop: SIZES.BASE,
    marginTop: SIZES.BASE / 2,
  },
  totalLabel: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
  },
  totalValue: {
    fontSize: SIZES.XLARGE,
    fontWeight: 'bold',
    color: COLORS.PRIMARY,
  },
  timelineContainer: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE,
    marginBottom: SIZES.BASE,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SIZES.BASE / 2,
  },
  timelineIcon: {
    fontSize: SIZES.LARGE,
    marginRight: SIZES.BASE,
    color: COLORS.PRIMARY,
  },
  timelineContent: {
    flex: 1,
  },
  timelineLabel: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    marginBottom: SIZES.BASE / 4,
  },
  timelineValue: {
    fontSize: SIZES.FONT,
    color: COLORS.BLACK,
    fontWeight: '600',
  },
  documentsContainer: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE,
    marginBottom: SIZES.BASE,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginBottom: SIZES.BASE,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SIZES.BASE / 2,
    paddingVertical: SIZES.BASE / 2,
  },
  documentIcon: {
    fontSize: SIZES.MEDIUM,
    marginRight: SIZES.BASE / 2,
    marginTop: SIZES.BASE / 4,
  },
  documentBullet: {
    fontSize: 18,
    color: COLORS.PRIMARY,
    marginRight: SIZES.BASE,
    marginTop: -2,
    fontWeight: '700',
  },
  documentContent: {
    flex: 1,
  },
  documentTitle: {
    fontSize: SIZES.FONT,
    color: COLORS.BLACK,
    fontWeight: '600',
    marginBottom: SIZES.BASE / 4,
  },
  documentDescription: {
    fontSize: SIZES.SMALL,
    color: COLORS.GRAY,
    flex: 1,
  },
  remarksContainer: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE,
    marginBottom: SIZES.BASE,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  remarks: {
    fontSize: SIZES.FONT,
    color: COLORS.BLACK,
    lineHeight: SIZES.FONT * 1.5,
    fontStyle: 'italic',
  },
  descriptionContainer: {
    backgroundColor: COLORS.WHITE,
    borderRadius: BORDER_RADIUS.MEDIUM,
    padding: SIZES.BASE,
    marginBottom: SIZES.BASE,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  description: {
    fontSize: SIZES.FONT,
    color: COLORS.BLACK,
    lineHeight: SIZES.FONT * 1.5,
  },
  bottomPadding: {
    height: SIZES.BASE * 8,
  },

  // Disclaimer card — small, muted, separated from the main content so
  // it reads as a footnote rather than a warning.
  disclaimerCard: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 4,
    borderLeftColor: '#F4A100',
    padding: 14,
    borderRadius: 8,
    marginTop: SIZES.BASE * 2,
    marginBottom: SIZES.BASE,
  },
  disclaimerLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#92400E',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 18,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.WHITE,
    // Padding driven by safe-area insets inline; only the top
    // padding stays a flat value since there's no inset there.
    paddingTop: SIZES.BASE,
    borderTopWidth: 1,
    borderTopColor: COLORS.LIGHT_GRAY,
    shadowColor: COLORS.CARD_SHADOW,
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  bookButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: BORDER_RADIUS.MEDIUM,
    paddingVertical: SIZES.BASE * 1.5,
    alignItems: 'center',
  },
  bookButtonText: {
    color: COLORS.WHITE,
    fontSize: SIZES.LARGE,
    fontWeight: 'bold',
  },
});

export default ServiceDetailsScreen;
