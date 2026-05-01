import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
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
  const [service, setService] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const { serviceId } = route.params as { serviceId: any };

  useEffect(() => {
    loadServiceDetails();
  }, [serviceId]);

  const loadServiceDetails = async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const response: any = await getServiceById(serviceId);
      setService(response.data);
    } catch (error: any) {
      console.error('Error loading service details:', error);
      setError(error.message || STRINGS.ERROR_LOADING_SERVICE_DETAILS);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = (): void => {
    console.log('Retrying service details fetch...');
    loadServiceDetails();
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
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
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
              {/* Pricing breakdown — customer-facing only. We deliberately
                  hide partner_earning, company_margin, and total_expense as
                  those are internal accounting fields the customer should
                  never see. The sum the customer pays = user_cost + govt_fees. */}
              <View style={styles.pricingContainer}>
                <Text style={styles.sectionTitle}>Pricing Details</Text>
                <View style={styles.pricingRow}>
                  <Text style={styles.pricingLabel}>Service Fee</Text>
                  <Text style={styles.pricingValue}>₹ {service.user_cost || 0}</Text>
                </View>
                {Number(service.govt_fees) > 0 && (
                  <View style={styles.pricingRow}>
                    <Text style={styles.pricingLabel}>Government Fees</Text>
                    <Text style={styles.pricingValue}>₹ {service.govt_fees}</Text>
                  </View>
                )}
                <View style={[styles.pricingRow, styles.totalRow]}>
                  <Text style={styles.totalLabel}>Total Payable</Text>
                  <Text style={styles.totalValue}>
                    ₹ {(Number(service.user_cost) || 0) + (Number(service.govt_fees) || 0)}
                  </Text>
                </View>
              </View>

              {/* Timeline — only for fixed-price services */}
              <View style={styles.timelineContainer}>
                <Text style={styles.sectionTitle}>Expected Timeline</Text>
                <View style={styles.timelineRow}>
                  <Text style={styles.timelineIcon}>?</Text>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineLabel}>Expected Timeline:</Text>
                    <Text style={styles.timelineValue}>{service.expected_timeline || 'N/A'}</Text>
                  </View>
                </View>
                <View style={styles.timelineRow}>
                  <Text style={styles.timelineIcon}>?</Text>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineLabel}>Processing Time:</Text>
                    <Text style={styles.timelineValue}>{service.processing_time || service.estimated_time || 'N/A'}</Text>
                  </View>
                </View>
                <View style={styles.timelineRow}>
                  <Text style={styles.timelineIcon}>?</Text>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineLabel}>Expected Delivery:</Text>
                    <Text style={styles.timelineValue}>{service.expected_delivery || 'N/A'}</Text>
                  </View>
                </View>
              </View>
            </>
          )}

          {/* Required Documents */}
          {service.required_documents && (
            <View style={styles.documentsContainer}>
              <Text style={styles.sectionTitle}>{STRINGS.REQUIRED_DOCUMENTS}</Text>
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

      {/* Fixed CTA — label depends on pricing model */}
      <View style={styles.buttonContainer}>
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
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.WHITE,
    padding: SIZES.BASE,
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
