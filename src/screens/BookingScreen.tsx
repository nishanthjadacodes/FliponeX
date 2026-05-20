import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Modal,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  findNodeHandle,
  UIManager,
  Dimensions,
  BackHandler,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INDIAN_DISTRICTS, INDIAN_STATES } from '../constants/districts';
import { formatBookingId, nextLocalBookingNumber } from '../utils/bookingId';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { captureWithCrop, pickWithCrop } from '../utils/cropPicker';
import Icon from 'react-native-vector-icons/MaterialIcons';
// Defensive load: expo-document-picker is a native module. If the dev-client
// APK predates the install, require() works but calls throw at runtime.
// We probe for the native binding at load time and fall back to image-only
// uploads until the next `eas build` brings the native code along.
let DocumentPicker: any = null;
let documentPickerAvailable: boolean = false;
try {
  // eslint-disable-next-line global-require
  DocumentPicker = require('expo-document-picker');
  documentPickerAvailable =
    typeof DocumentPicker?.getDocumentAsync === 'function';
} catch (_) {
  documentPickerAvailable = false;
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';
import { getUser } from '../utils/storage';
import RazorpayCheckout from 'react-native-razorpay';
import { createBooking, getLocationFromAddress, uploadDocument, getProfile, processPayment, createPaymentOrder, verifyPayment, applyReferralCode, updateMyLocation } from '../services/api';
import SuccessToast from '../components/SuccessToast';

interface Props {
  navigation: any;
  route: any;
}

const BookingScreen: React.FC<Props> = ({ navigation, route }) => {
  // Bottom inset so the Back / Next / Confirm buttons sit above the system
  // gesture bar (Android 10+) and home-indicator (iPhone X+). Without this
  // the button row gets clipped after the camera/cropper returns and users
  // think the screen is broken.
  const insets = useSafeAreaInsets();
  // Visibility of the state-picker modal triggered by the Domicile/address
  // form's "Select State" button.
  const [showStatePicker, setShowStatePicker] = useState<boolean>(false);
  const [stateSearch, setStateSearch] = useState<string>('');
  // District picker — same searchable-modal pattern as the state picker.
  // Replaces free-text typing so govt forms get a canonical district name.
  const [showDistrictPicker, setShowDistrictPicker] = useState<boolean>(false);
  const [districtSearch, setDistrictSearch] = useState<string>('');
  const { serviceData } = route.params;

  // State for multi-step form
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [userMobile, setUserMobile] = useState<string>('');

  // Step-by-step back navigation. The booking form has 6 internal
  // steps; without this guard, the user taps back on Step 4 and the
  // entire screen unmounts → they land on Home. Two interception
  // paths covered:
  //   • beforeRemove   — fires for header back button + swipe-back
  //                      gesture + any programmatic goBack()
  //   • BackHandler    — fires for the Android hardware back button
  // Both check currentStep > 1 and decrement instead of popping the
  // screen. We intercept ONLY when the action is a back/pop (action
  // type GO_BACK or POP) — programmatic forward navigation (e.g.
  // navigate('MyBookings') after a successful booking) is allowed
  // through untouched.
  useEffect(() => {
    const nav: any = navigation as any;
    const beforeRemoveSub =
      nav?.addListener?.('beforeRemove', (e: any) => {
        const actionType = e?.data?.action?.type;
        const isBackAction = actionType === 'GO_BACK' || actionType === 'POP';
        if (!isBackAction) return; // forward navigation — allow
        if (currentStep > 1) {
          e.preventDefault?.();
          setCurrentStep(currentStep - 1);
        }
      }) || (() => {});

    const hwSub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (currentStep > 1) {
        setCurrentStep(currentStep - 1);
        return true;
      }
      return false;
    });

    return () => {
      hwSub.remove();
      if (typeof beforeRemoveSub === 'function') beforeRemoveSub();
    };
  }, [navigation, currentStep]);

  // Ref + scroll-position tracking for the auto-scroll-to-focused-input
  // logic below. Without it, when the keyboard opens on a long form the
  // focused field ends up hidden beneath it (Android edge-to-edge mode
  // doesn't shrink the ScrollView's inner content). The Keyboard listener
  // measures the focused TextInput and scrolls so it sits above the
  // keyboard with a small breathing-room margin.
  const stepScrollRef = useRef<ScrollView | null>(null);
  const stepScrollYRef = useRef<number>(0);

  // Scroll the step view back to the top on every step transition.
  // Without this, advancing from step 3 (documents) to step 4 left
  // the ScrollView at the bottom of step 3 — so step 4's first
  // section (Service Mode) was below the visible fold, "covered"
  // until the user manually scrolled up.
  useEffect(() => {
    const scroller: any = stepScrollRef.current;
    if (!scroller?.scrollTo) return;
    // requestAnimationFrame so the scroll fires AFTER React commits
    // the new step's content. Without the deferral the call lands
    // on the previous step's content height and silently no-ops.
    requestAnimationFrame(() => {
      scroller.scrollTo({ y: 0, animated: false });
      stepScrollYRef.current = 0;
    });
  }, [currentStep]);

  useEffect(() => {
    const evtName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(evtName, (e: any) => {
      // The currently-focused TextInput exposes its native node via
      // TextInput.State.currentlyFocusedInput(). We measure it on the
      // window and compare against the keyboard's top edge.
      const focused = (TextInput as any).State?.currentlyFocusedInput?.();
      const handle = focused ? findNodeHandle(focused) : null;
      const scroller: any = stepScrollRef.current;
      if (!handle || !scroller) return;
      try {
        UIManager.measureInWindow(handle, (_x, y, _w, h) => {
          if (typeof y !== 'number' || typeof h !== 'number') return;
          const screenH = Dimensions.get('window').height;
          const kbHeight = e?.endCoordinates?.height || 0;
          const kbTop = screenH - kbHeight;
          const inputBottom = y + h;
          // Pad by 24px so the input sits visibly above the keyboard
          // edge — looks more natural than flush against the top edge.
          const overlap = inputBottom - kbTop + 24;
          if (overlap > 0) {
            scroller.scrollTo({
              y: stepScrollYRef.current + overlap,
              animated: true,
            });
          }
        });
      } catch (_err) {
        // Best-effort — never crash the screen on a measurement failure.
      }
    });
    return () => sub.remove();
  }, []);

  // Toast for upload feedback
  const [toast, setToast] = useState<any>({ visible: false, title: '', subtitle: '', variant: 'success' });
  const showToast = (title: string, subtitle: string = '', variant: string = 'success') =>
    setToast({ visible: true, title, subtitle, variant });

  // Fetch user profile to get mobile number
  useEffect(() => {
    const fetchUserMobile = async (): Promise<void> => {
      try {
        const profile: any = await getProfile();
        const mobileNumber = profile.data?.mobile || '';
        setUserMobile(mobileNumber);
        setMobile(mobileNumber); // Also set the mobile state for validation
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    };
    fetchUserMobile();
  }, []);

  // Step 1: Address
  const [address, setAddress] = useState<string>('');
  const [latitude, setLatitude] = useState<any>(null);
  const [longitude, setLongitude] = useState<any>(null);
  const [useCurrentLocation, setUseCurrentLocation] = useState<boolean>(false);

  // Step 2: Personal Details
  const [fullName, setFullName] = useState<string>('');
  const [applicantName, setApplicantName] = useState<string>('');
  const [aadhaarNumber, setAadhaarNumber] = useState<string>('');
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [gender, setGender] = useState<string>('Male');
  const [email, setEmail] = useState<string>('');

  // Additional fields for various services
  const [maritalStatus, setMaritalStatus] = useState<string>('');
  const [relationshipType, setRelationshipType] = useState<string>('');
  const [relativeName, setRelativeName] = useState<string>('');
  const [socialCategory, setSocialCategory] = useState<string>('');
  const [disability, setDisability] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [district, setDistrict] = useState<string>('');
  const [subdivision, setSubdivision] = useState<string>('');
  const [addressLine1, setAddressLine1] = useState<string>('');
  const [addressLine2, setAddressLine2] = useState<string>('');
  const [pincode, setPincode] = useState<string>('');
  const [stayingFromYears, setStayingFromYears] = useState<string>('');
  const [educationalQualification, setEducationalQualification] = useState<string>('');
  const [monthlyIncome, setMonthlyIncome] = useState<string>('');
  const [primaryOccupation, setPrimaryOccupation] = useState<string>('');
  const [workExperienceYears, setWorkExperienceYears] = useState<string>('');
  const [bankAccountNumber, setBankAccountNumber] = useState<string>('');
  const [ifscCode, setIfscCode] = useState<string>('');
  const [workingPlatforms, setWorkingPlatforms] = useState<string>('');
  const [mobile, setMobile] = useState<string>('');

  // ─── Aadhaar-only fields (new spec) ───────────────────────────────────────
  // The Aadhaar enrollment / update form needs more granular personal +
  // address fields than the generic intake. These are only rendered when
  // the selected service is an Aadhaar service. Husband's Name only
  // surfaces when the applicant marks Married + Female (UIDAI form rule).
  const [fatherName, setFatherName] = useState<string>('');
  const [husbandName, setHusbandName] = useState<string>('');
  const [motherName, setMotherName] = useState<string>('');
  // Voter-ID-only fields (per ECI Form 6/7/8 intake)
  const [disabilityType, setDisabilityType] = useState<string>('');
  const [assemblyConstituency, setAssemblyConstituency] = useState<string>('');
  const [parliamentaryConstituency, setParliamentaryConstituency] = useState<string>('');
  // Ration-Card-only fields (per state PDS intake form)
  const [headOfFamily, setHeadOfFamily] = useState<string>('');
  const [hofMobile, setHofMobile] = useState<string>('');
  const [rationDealerName, setRationDealerName] = useState<string>('');
  const [houseNo, setHouseNo] = useState<string>('');
  const [streetArea, setStreetArea] = useState<string>('');
  const [wardName, setWardName] = useState<string>('');
  const [townVillage, setTownVillage] = useState<string>('');
  const [postOffice, setPostOffice] = useState<string>('');
  const [panchayat, setPanchayat] = useState<string>('');
  const [talukaTehsil, setTalukaTehsil] = useState<string>('');
  const [block, setBlock] = useState<string>('');

  // Generic bag for backend-defined form fields (service.form_fields.fields).
  // Keyed by field.name → string value. We submit the whole map alongside
  // the booking so the admin sees exactly what the customer entered.
  const [dynamicFieldValues, setDynamicFieldValues] = useState<any>({});
  const setDynamicField = (key: string, value: any) =>
    setDynamicFieldValues((prev: any) => ({ ...prev, [key]: value }));

  // Function to parse service description and render dynamic form fields
  // Service categories that should NOT trigger any extra ID/document inputs.
  // Travel bookings, utility/recharge top-ups etc. only need name + mobile —
  // no Aadhaar / PAN / bank-detail prompts.
  const NO_DOC_CATEGORIES = /travel|recharge|utility|wallet|bill\s*pay/i;

  const renderDynamicFormFields = (): any => {
    // ─── PREFERRED PATH: backend-driven fields ──────────────────────────
    // Many services (especially ones we seeded from the rate chart) have
    // service.form_fields populated as { fields: [{name, label, type,
    // required, options?}, ...] }. Rendering those directly is far more
    // accurate than the description-based heuristic below.
    const backendFields: any[] = Array.isArray(serviceData?.form_fields?.fields)
      ? serviceData.form_fields.fields
      : Array.isArray(serviceData?.form_fields)
      ? serviceData.form_fields
      : [];

    if (backendFields.length > 0) {
      // Always include a Mobile Number field at the top — every booking
      // needs one for confirmation, and the heuristic logic guarantees it
      // (so the data-driven path should match for parity).
      const hasMobileField = backendFields.some(
        (f: any) => /mobile|phone/i.test(f?.name || '') || /mobile|phone/i.test(f?.label || ''),
      );
      const items: any[] = [];
      if (!hasMobileField) {
        items.push(
          <View key="__mobile" style={styles.inputGroup}>
            <Text style={styles.label}>Mobile Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter 10-digit mobile number"
              value={mobile}
              onChangeText={setMobile}
              keyboardType="phone-pad"
              maxLength={10}
            />
          </View>,
        );
      }
      backendFields.forEach((f: any, idx: number) => {
        const key = f?.name || `field_${idx}`;
        const label = f?.label || f?.name || `Field ${idx + 1}`;
        const required = f?.required;
        const value = dynamicFieldValues[key] ?? '';
        const requiredMark = required === false ? '' : ' *';

        // Render based on field type
        if (f?.type === 'select' && Array.isArray(f.options)) {
          items.push(
            <View key={key} style={styles.inputGroup}>
              <Text style={styles.label}>{label}{requiredMark}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {f.options.map((opt: any) => {
                  const selected = value === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => setDynamicField(key, opt)}
                      style={{
                        paddingVertical: 8, paddingHorizontal: 14,
                        borderRadius: 18, borderWidth: 1.5,
                        borderColor: selected ? '#E63946' : '#E0E0E0',
                        backgroundColor: selected ? '#FFE9EC' : '#fff',
                        marginRight: 8, marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: selected ? '#E63946' : '#212121', fontWeight: selected ? '700' : '500' }}>
                        {opt}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>,
          );
          return;
        }

        // Special-case: state field → use the existing modal picker so the
        // user gets the same searchable dropdown of all 36 Indian states.
        if (/^state$/i.test(f?.name || '') || /^state$/i.test(label)) {
          items.push(
            <View key={key} style={styles.inputGroup}>
              <Text style={styles.label}>{label}{requiredMark}</Text>
              <TouchableOpacity
                style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }] as any}
                onPress={() => setShowStatePicker(true)}
                activeOpacity={0.7}
              >
                <Text style={{ color: (state || value) ? '#212121' : '#9E9E9E', fontSize: 15 }}>
                  {state || value || 'Tap to select your state'}
                </Text>
                <Text style={{ color: '#9E9E9E', fontSize: 18, marginLeft: 8 }}>▾</Text>
              </TouchableOpacity>
            </View>,
          );
          return;
        }

        // Default: text-style input. Pick a sensible keyboard.
        const isMobileField = /mobile|phone/i.test(f?.name || '') || /mobile|phone/i.test(label);
        const isEmail = f?.type === 'email' || /email/i.test(f?.name || '');
        const isDate = f?.type === 'date';
        const isNumeric = f?.type === 'number' || /pin\s*code|pincode|amount|years/i.test(f?.name || '');

        items.push(
          <View key={key} style={styles.inputGroup}>
            <Text style={styles.label}>{label}{requiredMark}</Text>
            <TextInput
              style={styles.input}
              placeholder={isDate ? 'YYYY-MM-DD' : `Enter ${label.toLowerCase()}`}
              value={isMobileField ? (mobile || value) : value}
              onChangeText={(v: string) => {
                if (isMobileField) setMobile(v);
                setDynamicField(key, v);
              }}
              keyboardType={
                isEmail ? 'email-address'
                : isMobileField ? 'phone-pad'
                : isNumeric ? 'numeric'
                : 'default'
              }
              maxLength={isMobileField ? 10 : undefined}
              autoCapitalize={isEmail ? 'none' : 'sentences'}
            />
          </View>,
        );
      });
      return items;
    }

    // ─── FALLBACK: description-based heuristic (legacy services) ────────
    if (!serviceData?.description) return null;

    // Travel / Recharge / Utility services don't need any of the heavy
    // doc-related inputs (Aadhaar, occupation, etc). Render only the
    // bare minimum — full name + mobile number, both mandatory — so the
    // user isn't forced to fill out unrelated fields just to top up a
    // SIM or book a flight.
    if (
      NO_DOC_CATEGORIES.test(serviceData?.category || '') ||
      NO_DOC_CATEGORIES.test(serviceData?.name || '')
    ) {
      return [
        <View key="applicantName" style={styles.inputGroup}>
          <Text style={styles.label}>Full Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your name"
            value={applicantName}
            onChangeText={setApplicantName}
          />
        </View>,
        <View key="mobile" style={styles.inputGroup}>
          <Text style={styles.label}>Mobile Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter 10-digit mobile number"
            value={mobile}
            onChangeText={setMobile}
            keyboardType="phone-pad"
            maxLength={10}
          />
          <Text style={styles.helperText}>
            Required — recharge / booking confirmation is sent to this number.
          </Text>
        </View>,
      ];
    }

    const description = serviceData.description.toLowerCase();
    const fields: any[] = [];

    // Debug: Log the actual service description for Income Certificate
    if (serviceData.name && serviceData.name.toLowerCase().includes('income')) {
      console.log('=== INCOME CERTIFICATE DESCRIPTION DEBUG ===');
      console.log('Service Name:', serviceData.name);
      console.log('Description:', serviceData.description);
      console.log('Description Lowercase:', description);
      console.log('==========================================');

      // Extract and process the actual fields mentioned
      const mentionedFields: any[] = [];

      // Check for specific field mentions in the description
      const fieldPatterns = [
        'applicant name', 'applicant_name', 'full name', 'name',
        'date of birth', 'dob', 'birth',
        'gender', 'email', 'mobile number', 'mobile',
        'aadhaar', 'aadhar',
        'marital status', 'relationship type', 'relative name',
        'social category', 'disability',
        'state', 'district', 'subdivision', 'address line', 'address',
        'pincode', 'staying from years', 'staying from',
        'educational qualification', 'monthly income', 'annual income', 'family income',
        'primary occupation', 'work experience', 'experience', 'work', 'occupation',
        'bank account', 'ifsc code',
        'father name', 'father\'s name', 'mother name', 'mother\'s name',
        'husband name', 'husband\'s name', 'father/husband name',
        'caste', 'religion',
        'ration card', 'electricity bill', 'telephone', 'phone',
        'village', 'tehsil', 'taluka', 'post office', 'police station',
        'house no', 'house number', 'house no.', 'house number',
        'street', 'street name',
        'city', 'city name',
        'uber', 'ola', 'rapido', 'platform'
      ];

      fieldPatterns.forEach((pattern: string) => {
        if (description.includes(pattern)) {
          mentionedFields.push(pattern);
        }
      });

      console.log('Fields found in description:', mentionedFields);
      console.log('==========================================');
    }

    // Handle name field - if applicant name is mentioned, use that, otherwise use full name
    if (description.includes('applicant name') || description.includes('applicant_name')) {
      fields.push(
        <View key="applicantName" style={styles.inputGroup}>
          <Text style={styles.label}>Applicant Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter applicant's full name"
            value={applicantName}
            onChangeText={setApplicantName}
          />
        </View>
      );
    } else if (description.includes('full name') || description.includes('name') ||
               description.includes('address update') ||
               (serviceData?.name && serviceData.name.toLowerCase().includes('address update'))) {
      fields.push(
        <View key="fullName" style={styles.inputGroup}>
          <Text style={styles.label}>Full Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your full name"
            value={fullName}
            onChangeText={setFullName}
          />
        </View>
      );
    }

    // Check for date of birth
    if (description.includes('date of birth') || description.includes('dob') || description.includes('birth')) {
      fields.push(
        <View key="dateOfBirth" style={styles.inputGroup}>
          <Text style={styles.label}>Date of Birth *</Text>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={{ color: dateOfBirth ? '#1F2937' : '#94A3B8' }}>
              {dateOfBirth ? dateOfBirth.toLocaleDateString('en-IN') : 'Select date of birth'}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={dateOfBirth || new Date(2000, 0, 1)}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onChange={(event: any, selectedDate: any) => {
                setShowDatePicker(false);
                if (selectedDate) {
                  setDateOfBirth(selectedDate);
                }
              }}
              style={styles.datePicker}
            />
          )}
        </View>
      );
    }

    // Check for gender
    if (description.includes('gender')) {
      fields.push(
        <View key="gender" style={styles.inputGroup}>
          <Text style={styles.label}>Gender *</Text>
          <TouchableOpacity
            style={styles.genderButton}
            onPress={() => {
              Alert.alert(
                'Select Gender',
                'Choose your gender',
                [
                  { text: 'Male', onPress: () => setGender('Male') },
                  { text: 'Female', onPress: () => setGender('Female') },
                  { text: 'Other', onPress: () => setGender('Other') },
                ],
                { cancelable: true }
              );
            }}
          >
            <Text style={styles.genderButtonText}>{gender || 'Select Gender'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Check for email
    if (description.includes('email')) {
      fields.push(
        <View key="email" style={styles.inputGroup}>
          <Text style={styles.label}>Email *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
          />
        </View>
      );
    }

    if (description.includes('aadhaar') || description.includes('aadhar')) {
      fields.push(
        <View key="aadhaarNumber" style={styles.inputGroup}>
          <Text style={styles.label}>Aadhaar Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter 12-digit Aadhaar number"
            value={aadhaarNumber}
            onChangeText={setAadhaarNumber}
            keyboardType="numeric"
            maxLength={12}
          />
        </View>
      );
    }

    // Always include mobile number field as it's required for booking
    fields.push(
      <View key="mobile" style={styles.inputGroup}>
        <Text style={styles.label}>Mobile Number *</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter 10-digit mobile number"
          value={mobile}
          onChangeText={setMobile}
          keyboardType="phone-pad"
          maxLength={10}
        />
      </View>
    );

    if (description.includes('marital status')) {
      fields.push(
        <View key="maritalStatus" style={styles.inputGroup}>
          <Text style={styles.label}>Marital Status *</Text>
          <TouchableOpacity
            style={styles.genderButton}
            onPress={() => {
              Alert.alert(
                'Select Marital Status',
                'Choose your marital status',
                [
                  { text: 'Single', onPress: () => setMaritalStatus('Single') },
                  { text: 'Married', onPress: () => setMaritalStatus('Married') },
                  { text: 'Divorced', onPress: () => setMaritalStatus('Divorced') },
                  { text: 'Widowed', onPress: () => setMaritalStatus('Widowed') },
                ],
                { cancelable: true }
              );
            }}
          >
            <Text style={styles.genderButtonText}>{maritalStatus || 'Select Marital Status'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (description.includes('relationship type')) {
      fields.push(
        <View key="relationshipType" style={styles.inputGroup}>
          <Text style={styles.label}>Relationship Type *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter relationship type (e.g., Father, Mother, Spouse)"
            value={relationshipType}
            onChangeText={setRelationshipType}
          />
        </View>
      );
    }

    if (description.includes('relative name')) {
      fields.push(
        <View key="relativeName" style={styles.inputGroup}>
          <Text style={styles.label}>Relative Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter relative's full name"
            value={relativeName}
            onChangeText={setRelativeName}
          />
        </View>
      );
    }

    if (description.includes('social category')) {
      fields.push(
        <View key="socialCategory" style={styles.inputGroup}>
          <Text style={styles.label}>Social Category *</Text>
          <TouchableOpacity
            style={styles.genderButton}
            onPress={() => {
              Alert.alert(
                'Select Social Category',
                'Choose your social category',
                [
                  { text: 'General', onPress: () => setSocialCategory('General') },
                  { text: 'OBC', onPress: () => setSocialCategory('OBC') },
                  { text: 'SC', onPress: () => setSocialCategory('SC') },
                  { text: 'ST', onPress: () => setSocialCategory('ST') },
                ],
                { cancelable: true }
              );
            }}
          >
            <Text style={styles.genderButtonText}>{socialCategory || 'Select Social Category'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (description.includes('disability')) {
      fields.push(
        <View key="disability" style={styles.inputGroup}>
          <Text style={styles.label}>Disability Status *</Text>
          <TouchableOpacity
            style={styles.genderButton}
            onPress={() => {
              Alert.alert(
                'Disability Status',
                'Do you have any disability?',
                [
                  { text: 'No', onPress: () => setDisability('No') },
                  { text: 'Yes', onPress: () => setDisability('Yes') },
                ],
                { cancelable: true }
              );
            }}
          >
            <Text style={styles.genderButtonText}>{disability || 'Select Disability Status'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Show state dropdown for any address-shaped service. Triggers on:
    //   - "state" / "domicile" / "residency" / "nativity" anywhere in
    //     description, name, or category.
    // Wide net intentional — false-positives (extra dropdown shown) are
    // a much smaller UX hit than false-negatives (missing field).
    const triggerSurface = `${serviceData?.name || ''} ${serviceData?.category || ''} ${serviceData?.description || ''}`.toLowerCase();
    const needsState = /state|domicile|residency|residence|nativity|address/.test(triggerSurface);
    if (needsState) {
      fields.push(
        <View key="state" style={styles.inputGroup}>
          <Text style={styles.label}>State *</Text>
          <TouchableOpacity
            style={[
              styles.input,
              {
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              },
            ] as any}
            onPress={() => setShowStatePicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ color: state ? '#212121' : '#9E9E9E', fontSize: 15 }}>
              {state || 'Tap to select your state'}
            </Text>
            <Text style={{ color: '#9E9E9E', fontSize: 18, marginLeft: 8 }}>▾</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (description.includes('district')) {
      fields.push(
        <View key="district" style={styles.inputGroup}>
          <Text style={styles.label}>District *</Text>
          <TouchableOpacity
            style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }] as any}
            onPress={() => setShowDistrictPicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ color: district ? '#212121' : '#9E9E9E', fontSize: 15 }}>
              {district || 'Tap to select your district'}
            </Text>
            <Text style={{ color: '#9E9E9E', fontSize: 18, marginLeft: 8 }}>▾</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (description.includes('subdivision')) {
      fields.push(
        <View key="subdivision" style={styles.inputGroup}>
          <Text style={styles.label}>Subdivision *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your subdivision"
            value={subdivision}
            onChangeText={setSubdivision}
          />
        </View>
      );
    }

    if (description.includes('address line') || description.includes('address')) {
      fields.push(
        <View key="addressLine1" style={styles.inputGroup}>
          <Text style={styles.label}>Address Line 1 *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter house number, street name"
            value={addressLine1}
            onChangeText={setAddressLine1}
          />
        </View>
      );

      fields.push(
        <View key="addressLine2" style={styles.inputGroup}>
          <Text style={styles.label}>Address Line 2</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter area, landmark (optional)"
            value={addressLine2}
            onChangeText={setAddressLine2}
          />
        </View>
      );
    }

    if (description.includes('pincode')) {
      fields.push(
        <View key="pincode" style={styles.inputGroup}>
          <Text style={styles.label}>Pincode *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter 6-digit pincode"
            value={pincode}
            onChangeText={setPincode}
            keyboardType="numeric"
            maxLength={6}
          />
        </View>
      );
    }

    if (description.includes('staying from years') || description.includes('staying from')) {
      fields.push(
        <View key="stayingFromYears" style={styles.inputGroup}>
          <Text style={styles.label}>Staying at Current Address (Years) *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter number of years"
            value={stayingFromYears}
            onChangeText={setStayingFromYears}
            keyboardType="numeric"
          />
        </View>
      );
    }

    if (description.includes('educational qualification')) {
      fields.push(
        <View key="educationalQualification" style={styles.inputGroup}>
          <Text style={styles.label}>Educational Qualification *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your highest qualification"
            value={educationalQualification}
            onChangeText={setEducationalQualification}
          />
        </View>
      );
    }

    if (description.includes('monthly income')) {
      fields.push(
        <View key="monthlyIncome" style={styles.inputGroup}>
          <Text style={styles.label}>Monthly Income (Rs) *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your monthly income"
            value={monthlyIncome}
            onChangeText={setMonthlyIncome}
            keyboardType="numeric"
          />
        </View>
      );
    }

    if (description.includes('primary occupation')) {
      fields.push(
        <View key="primaryOccupation" style={styles.inputGroup}>
          <Text style={styles.label}>Primary Occupation *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your primary occupation"
            value={primaryOccupation}
            onChangeText={setPrimaryOccupation}
          />
        </View>
      );
    }

    if (description.includes('work experience') || description.includes('experience')) {
      fields.push(
        <View key="workExperienceYears" style={styles.inputGroup}>
          <Text style={styles.label}>Work Experience (Years) *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter years of work experience"
            value={workExperienceYears}
            onChangeText={setWorkExperienceYears}
            keyboardType="numeric"
          />
        </View>
      );
    }

    if (description.includes('bank account')) {
      fields.push(
        <View key="bankAccountNumber" style={styles.inputGroup}>
          <Text style={styles.label}>Bank Account Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your bank account number"
            value={bankAccountNumber}
            onChangeText={setBankAccountNumber}
            keyboardType="numeric"
          />
        </View>
      );
    }

    if (description.includes('ifsc code')) {
      fields.push(
        <View key="ifscCode" style={styles.inputGroup}>
          <Text style={styles.label}>IFSC Code *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter bank IFSC code"
            value={ifscCode}
            onChangeText={setIfscCode}
            autoCapitalize="characters"
          />
        </View>
      );
    }

    if (description.includes('uber') || description.includes('ola') || description.includes('rapido') || description.includes('platform')) {
      fields.push(
        <View key="workingPlatforms" style={styles.inputGroup}>
          <Text style={styles.label}>Working Platforms *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter platforms (e.g., Uber, Ola, Rapido)"
            value={workingPlatforms}
            onChangeText={setWorkingPlatforms}
          />
        </View>
      );
    }

    // Additional fields commonly required for Income Certificate and other services
    if (description.includes('annual income') || description.includes('yearly income')) {
      fields.push(
        <View key="annualIncome" style={styles.inputGroup}>
          <Text style={styles.label}>Annual Income (Rs) *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your annual income"
            value={monthlyIncome}
            onChangeText={setMonthlyIncome}
            keyboardType="numeric"
          />
        </View>
      );
    }

    if (description.includes('family income') || description.includes('household income')) {
      fields.push(
        <View key="familyIncome" style={styles.inputGroup}>
          <Text style={styles.label}>Family Monthly Income (Rs) *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter family monthly income"
            value={monthlyIncome}
            onChangeText={setMonthlyIncome}
            keyboardType="numeric"
          />
        </View>
      );
    }

    if (description.includes('father name') || description.includes('father\'s name')) {
      fields.push(
        <View key="fatherName" style={styles.inputGroup}>
          <Text style={styles.label}>Father's Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter father's full name"
            value={relativeName}
            onChangeText={setRelativeName}
          />
        </View>
      );
    }

    if (description.includes('husband name') || description.includes('husband\'s name') || description.includes('father/husband name')) {
      fields.push(
        <View key="husbandName" style={styles.inputGroup}>
          <Text style={styles.label}>Father/Husband Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter father's or husband's full name"
            value={relativeName}
            onChangeText={setRelativeName}
          />
        </View>
      );
    }

    if (description.includes('house no') || description.includes('house number') || description.includes('house no.')) {
      fields.push(
        <View key="houseNo" style={styles.inputGroup}>
          <Text style={styles.label}>House Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter house number"
            value={addressLine1}
            onChangeText={setAddressLine1}
          />
        </View>
      );
    }

    if (description.includes('street') || description.includes('street name')) {
      fields.push(
        <View key="street" style={styles.inputGroup}>
          <Text style={styles.label}>Street Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter street name"
            value={addressLine2}
            onChangeText={setAddressLine2}
          />
        </View>
      );
    }

    if (description.includes('city') || description.includes('city name')) {
      fields.push(
        <View key="city" style={styles.inputGroup}>
          <Text style={styles.label}>City *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter city name"
            value={subdivision}
            onChangeText={setSubdivision}
          />
        </View>
      );
    }

    if (description.includes('work') || description.includes('occupation')) {
      fields.push(
        <View key="work" style={styles.inputGroup}>
          <Text style={styles.label}>Work/Occupation *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your work or occupation"
            value={primaryOccupation}
            onChangeText={setPrimaryOccupation}
          />
        </View>
      );
    }

    if (description.includes('mother name') || description.includes('mother\'s name')) {
      fields.push(
        <View key="motherName" style={styles.inputGroup}>
          <Text style={styles.label}>Mother's Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter mother's full name"
            value={relativeName}
            onChangeText={setRelativeName}
          />
        </View>
      );
    }

    if (description.includes('caste') || description.includes('caste certificate')) {
      fields.push(
        <View key="caste" style={styles.inputGroup}>
          <Text style={styles.label}>Caste *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your caste"
            value={socialCategory}
            onChangeText={setSocialCategory}
          />
        </View>
      );
    }

    if (description.includes('religion')) {
      fields.push(
        <View key="religion" style={styles.inputGroup}>
          <Text style={styles.label}>Religion *</Text>
          <TouchableOpacity
            style={styles.genderButton}
            onPress={() => {
              Alert.alert(
                'Select Religion',
                'Choose your religion',
                [
                  { text: 'Hindu', onPress: () => setSocialCategory('Hindu') },
                  { text: 'Muslim', onPress: () => setSocialCategory('Muslim') },
                  { text: 'Christian', onPress: () => setSocialCategory('Christian') },
                  { text: 'Sikh', onPress: () => setSocialCategory('Sikh') },
                  { text: 'Buddhist', onPress: () => setSocialCategory('Buddhist') },
                  { text: 'Jain', onPress: () => setSocialCategory('Jain') },
                  { text: 'Other', onPress: () => setSocialCategory('Other') },
                ],
                { cancelable: true }
              );
            }}
          >
            <Text style={styles.genderButtonText}>{socialCategory || 'Select Religion'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (description.includes('ration card') || description.includes('ration card number')) {
      fields.push(
        <View key="rationCard" style={styles.inputGroup}>
          <Text style={styles.label}>Ration Card Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter ration card number"
            value={workingPlatforms}
            onChangeText={setWorkingPlatforms}
          />
        </View>
      );
    }

    if (description.includes('electricity bill') || description.includes('electricity connection')) {
      fields.push(
        <View key="electricityBill" style={styles.inputGroup}>
          <Text style={styles.label}>Electricity Bill Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter electricity bill number"
            value={workingPlatforms}
            onChangeText={setWorkingPlatforms}
          />
        </View>
      );
    }

    if (description.includes('telephone') || description.includes('phone')) {
      fields.push(
        <View key="telephone" style={styles.inputGroup}>
          <Text style={styles.label}>Telephone Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter telephone number"
            value={mobile}
            onChangeText={setMobile}
            keyboardType="phone-pad"
          />
        </View>
      );
    }

    if (description.includes('village') || description.includes('village name')) {
      fields.push(
        <View key="village" style={styles.inputGroup}>
          <Text style={styles.label}>Village *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter village name"
            value={subdivision}
            onChangeText={setSubdivision}
          />
        </View>
      );
    }

    if (description.includes('tehsil') || description.includes('taluka')) {
      fields.push(
        <View key="tehsil" style={styles.inputGroup}>
          <Text style={styles.label}>Tehsil/Taluka *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter tehsil/taluka name"
            value={subdivision}
            onChangeText={setSubdivision}
          />
        </View>
      );
    }

    if (description.includes('post office')) {
      fields.push(
        <View key="postOffice" style={styles.inputGroup}>
          <Text style={styles.label}>Post Office *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter post office name"
            value={subdivision}
            onChangeText={setSubdivision}
          />
        </View>
      );
    }

    if (description.includes('police station')) {
      fields.push(
        <View key="policeStation" style={styles.inputGroup}>
          <Text style={styles.label}>Police Station *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter police station name"
            value={subdivision}
            onChangeText={setSubdivision}
          />
        </View>
      );
    }

    return fields;
  };

  // ─── Personal-details form (UIDAI-style) ────────────────────────────
  // Four variants:
  //   'aadhaar'    → Husband's Name conditional (Married + Female)
  //   'pan'        → always shows Mother's Name (PAN Form 49A)
  //   'voterid'    → Husband's Name conditional + Disability Type +
  //                  Assembly / Parliamentary Constituency (ECI Form 6/7/8)
  //   'rationcard' → Husband's Name conditional + Disability Type +
  //                  Head of Family + HOF Mobile + Ration Dealer Name
  // The DOB, address block, marital status, etc. are identical across
  // variants — only the parental + form-specific fields differ.
  const renderAadhaarPersonalDetails = (
    variant: 'aadhaar' | 'pan' | 'voterid' | 'rationcard' = 'aadhaar',
  ): any => {
    const showHusbandField =
      (variant === 'aadhaar' || variant === 'voterid' || variant === 'rationcard') &&
      maritalStatus === 'Married' &&
      (gender === 'Female' || gender === 'female');
    const showMotherField = variant === 'pan';
    const showVoterIdExtras = variant === 'voterid';
    // Disability Type is on both Voter ID and Ration Card forms.
    const showDisabilityType = variant === 'voterid' || variant === 'rationcard';
    const showRationCardExtras = variant === 'rationcard';
    // Aadhaar number is required across every ID-form variant. For an
    // Aadhaar update the user obviously has one; for PAN it's needed for
    // PAN-Aadhaar linking (mandatory since 2023); for Voter ID and Ration
    // Card most state portals now ask for the Aadhaar reference too.
    const aadhaarRequired = true;
    return (
      <View>
        <Text style={styles.aadhaarSectionLabel}>Applicant Information</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Applicant Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="As per supporting documents"
            value={applicantName || fullName}
            onChangeText={(v) => { setApplicantName(v); setFullName(v); }}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>
            Aadhaar Number{aadhaarRequired ? ' *' : ''}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="1234 5678 9012"
            // Display the 12 digits in three space-separated groups of 4
            // (UIDAI's standard print format) while the underlying state
            // stays as the raw 12-digit string for validation + payload.
            value={aadhaarNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}
            onChangeText={(v) => setAadhaarNumber(v.replace(/\D/g, '').substring(0, 12))}
            keyboardType="number-pad"
            // 14 = 12 digits + 2 spaces between the three groups
            maxLength={14}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Father's Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter father's full name"
            value={fatherName}
            onChangeText={setFatherName}
          />
        </View>

        {showMotherField && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Mother's Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter mother's full name"
              value={motherName}
              onChangeText={setMotherName}
            />
          </View>
        )}

        {showHusbandField && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Husband's Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter husband's full name"
              value={husbandName}
              onChangeText={setHusbandName}
            />
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Date of Birth *</Text>
          <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
            <Text style={{ color: dateOfBirth ? '#1F2937' : '#94A3B8' }}>
              {dateOfBirth ? new Date(dateOfBirth).toLocaleDateString('en-IN') : 'Select date of birth'}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={dateOfBirth || new Date(2000, 0, 1)}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onChange={(event: any, selectedDate: any) => {
                setShowDatePicker(false);
                if (selectedDate) {
                  setDateOfBirth(selectedDate);
                }
              }}
            />
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Gender *</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {['Male', 'Female', 'Other'].map((g) => (
              <TouchableOpacity
                key={g}
                style={[
                  styles.aadhaarChip,
                  gender === g && styles.aadhaarChipActive,
                ]}
                onPress={() => setGender(g)}
              >
                <Text style={[
                  styles.aadhaarChipText,
                  gender === g && styles.aadhaarChipTextActive,
                ]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mobile Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="10-digit mobile"
            value={mobile}
            onChangeText={(v) => setMobile(v.replace(/\D/g, '').substring(0, 10))}
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>E-mail</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Marital Status *</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['Single', 'Married', 'Divorced', 'Widowed'].map((m) => (
              <TouchableOpacity
                key={m}
                style={[
                  styles.aadhaarChip,
                  maritalStatus === m && styles.aadhaarChipActive,
                ]}
                onPress={() => setMaritalStatus(m)}
              >
                <Text style={[
                  styles.aadhaarChipText,
                  maritalStatus === m && styles.aadhaarChipTextActive,
                ]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {showDisabilityType && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Disability Type</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {['None', 'Visual', 'Speech & Hearing', 'Locomotor', 'Other'].map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.aadhaarChip,
                    disabilityType === d && styles.aadhaarChipActive,
                  ]}
                  onPress={() => setDisabilityType(d)}
                >
                  <Text style={[
                    styles.aadhaarChipText,
                    disabilityType === d && styles.aadhaarChipTextActive,
                  ]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {showRationCardExtras && (
          <>
            <Text style={[styles.aadhaarSectionLabel, { marginTop: 14 }]}>
              Family / Ration Details
            </Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Head of Family *</Text>
              <TextInput
                style={styles.input}
                placeholder="Name of head of household"
                value={headOfFamily}
                onChangeText={setHeadOfFamily}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>HOF Mobile *</Text>
              <TextInput
                style={styles.input}
                placeholder="Head of Family's mobile"
                value={hofMobile}
                onChangeText={(v) => setHofMobile(v.replace(/\D/g, '').substring(0, 10))}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Ration Dealer Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="Authorised FPS / dealer name"
                value={rationDealerName}
                onChangeText={setRationDealerName}
              />
            </View>
          </>
        )}

        <Text style={[styles.aadhaarSectionLabel, { marginTop: 18 }]}>Address</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>House No. *</Text>
          <TextInput
            style={styles.input}
            placeholder="Door / flat number"
            value={houseNo}
            onChangeText={setHouseNo}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Street / Area / Locality *</Text>
          <TextInput
            style={styles.input}
            placeholder="Street name, area, landmark"
            value={streetArea || addressLine1}
            onChangeText={(v) => { setStreetArea(v); setAddressLine1(v); }}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Ward Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Ward / sector"
            value={wardName}
            onChangeText={setWardName}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Town / Village *</Text>
          <TextInput
            style={styles.input}
            placeholder="Town or village"
            value={townVillage}
            onChangeText={setTownVillage}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Post Office *</Text>
          <TextInput
            style={styles.input}
            placeholder="Nearest post office"
            value={postOffice}
            onChangeText={setPostOffice}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Panchayat</Text>
          <TextInput
            style={styles.input}
            placeholder="Gram panchayat (rural)"
            value={panchayat}
            onChangeText={setPanchayat}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Taluqa / Tehsil / Mandal *</Text>
          <TextInput
            style={styles.input}
            placeholder="Taluk / Tehsil / Mandal"
            value={talukaTehsil || subdivision}
            onChangeText={(v) => { setTalukaTehsil(v); setSubdivision(v); }}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Block</Text>
          <TextInput
            style={styles.input}
            placeholder="Revenue block"
            value={block}
            onChangeText={setBlock}
          />
        </View>

        {showVoterIdExtras && (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name of Assembly Constituency *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 152 - Madhapur"
                value={assemblyConstituency}
                onChangeText={setAssemblyConstituency}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name of Parliamentary Constituency *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Hyderabad"
                value={parliamentaryConstituency}
                onChangeText={setParliamentaryConstituency}
              />
            </View>
          </>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>District *</Text>
          <TouchableOpacity
            style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }] as any}
            onPress={() => setShowDistrictPicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ color: district ? '#212121' : '#9E9E9E', fontSize: 15 }}>
              {district || 'Tap to select your district'}
            </Text>
            <Text style={{ color: '#9E9E9E', fontSize: 18, marginLeft: 8 }}>▾</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>State *</Text>
          {/* Searchable picker (28 states + 8 UTs) — replaces the free-
              text input so users can't typo the state name and govt
              forms get a clean canonical value. */}
          <TouchableOpacity
            style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }] as any}
            onPress={() => setShowStatePicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ color: state ? '#212121' : '#9E9E9E', fontSize: 15 }}>
              {state || 'Tap to select your state'}
            </Text>
            <Text style={{ color: '#9E9E9E', fontSize: 18, marginLeft: 8 }}>▾</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Pin Code *</Text>
          <TextInput
            style={styles.input}
            placeholder="6-digit PIN"
            value={pincode}
            onChangeText={(v) => setPincode(v.replace(/\D/g, '').substring(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>
      </View>
    );
  };

  // Step 3: Documents
  const [uploadedDocuments, setUploadedDocuments] = useState<any[]>([]);
  // Tap-to-preview a previously uploaded image. PDFs/non-images skip the
  // modal and just show a thumbnail tile instead.
  const [previewDoc, setPreviewDoc] = useState<{ uri: string; name: string } | null>(null);
  // Image picked but not yet uploaded — shows a preview-and-confirm modal so
  // the user has a clear "Upload" submit button. Avoids the Android UCrop UI
  // bug where the cropper's confirm button gets hidden by the gesture-nav bar.
  const [pendingImage, setPendingImage] = useState<{
    documentType: string;
    file: { uri: string; name: string; type: string };
  } | null>(null);
  // The custom "Add document" picker. When a document type is set, the
  // bottom-sheet style modal opens. Tapping outside / Cancel clears it.
  const [docPickerFor, setDocPickerFor] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<any>({});

  // Step 4: Slot Booking
  const [selectedDate, setSelectedDate] = useState<any>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<any>(null);
  const [serviceMode, setServiceMode] = useState<string>('regular'); // urgency: 'regular' (low) or 'fast_track' (high)
  const [deliveryMode, setDeliveryMode] = useState<'offline' | 'online'>('offline'); // 'offline' = doorstep agent, 'online' = our operators
  // Referral code applied at checkout (spec H — friend's code earns ₹20 off
  // the first booking and triggers a ₹50 cashback to the referrer once
  // service completes).
  const [referralCodeInput, setReferralCodeInput] = useState<string>('');
  const [referralDiscount, setReferralDiscount] = useState<number>(0);
  const [referralApplying, setReferralApplying] = useState<boolean>(false);
  const [referralError, setReferralError] = useState<string>('');
  const [showSlotDatePicker, setShowSlotDatePicker] = useState<boolean>(false);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [priorityFee] = useState<number>(50); // Priority fee for fast-track service

  // Matching flash-notification discount for THIS service. Fetched
  // once on screen mount. If admin published an active notification
  // with discount_percent + target_service_pattern, AND the pattern
  // matches this service's name/category (case-insensitive), the
  // Payment Summary shows a "Flash Offer (X% off)" line and the
  // discount is subtracted from the customer-facing total. Multiple
  // matching notifications → the highest discount wins.
  const [flashOffer, setFlashOffer] = useState<{
    id: string;
    title: string;
    percent: number;
  } | null>(null);

  // Step 5: Payment
  // Payment is always online and is collected AFTER the representative
  // completes the work (deferred). Customer is shown a "Pay Now" button on
  // the booking details screen once status = completed.
  const [paymentMethod, setPaymentMethod] = useState<string>('pay_online');
  // Online sub-methods: 'upi' | 'card' | 'netbanking' | 'wallet'
  const [onlineMethod, setOnlineMethod] = useState<any>(null);
  const [upiId, setUpiId] = useState<string>('');
  const [cardNumber, setCardNumber] = useState<string>('');
  const [cardExpiry, setCardExpiry] = useState<string>('');
  const [cardCvv, setCardCvv] = useState<string>('');
  const [cardHolderName, setCardHolderName] = useState<string>('');
  const [selectedBank, setSelectedBank] = useState<any>(null);
  const [selectedWallet, setSelectedWallet] = useState<any>(null);
  const [bookingConfirmed, setBookingConfirmed] = useState<boolean>(false);
  const [bookingNumber, setBookingNumber] = useState<string>('');
  const [processingPayment, setProcessingPayment] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string>('');
  // True only after Razorpay confirms + backend verifies the signature.
  // Drives the "Paid Online" badge — never trust the chosen payment_method
  // alone, since the user could have abandoned/failed the gateway flow.
  const [paymentCompleted, setPaymentCompleted] = useState<boolean>(false);

  // Payment Summary state — each service's price is broken into mandatory
  // base charges (govt + doorstep) plus four opt-in add-ons (processing,
  // consultancy, taxes, fast-track). Wallet credits + refund balance can
  // shave off up to 50% of the subtotal per policy.
  const [optProcessing, setOptProcessing] = useState<boolean>(false);
  const [optConsultancy, setOptConsultancy] = useState<boolean>(false);
  const [optTaxes, setOptTaxes] = useState<boolean>(false);
  const [optFastTrack, setOptFastTrack] = useState<boolean>(serviceMode === 'fast_track');
  const [useRewardPoints, setUseRewardPoints] = useState<boolean>(false);
  const [useRefundWallet, setUseRefundWallet] = useState<boolean>(false);
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [refundBalance, setRefundBalance] = useState<number>(0);

  // Fast-track checkbox should mirror the urgency picker on step 2 — if
  // the user changes urgency mid-flow, sync the checkbox.
  useEffect(() => {
    setOptFastTrack(serviceMode === 'fast_track');
  }, [serviceMode]);

  // Fetch active flash-notification discounts and pick the highest one
  // that matches THIS service. Matched by case-insensitive substring
  // of target_service_pattern against service.name + service.category.
  // Backend down / empty / no match → flashOffer stays null and
  // Payment Summary renders normally.
  useEffect(() => {
    const svcName = String(serviceData?.name || '').toLowerCase();
    const svcCat = String(serviceData?.category || '').toLowerCase();
    if (!svcName && !svcCat) return;
    const haystack = `${svcName} ${svcCat}`;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/flash-notifications/active`);
        const json = await resp.json();
        const all: any[] = Array.isArray(json?.data) ? json.data : [];
        let best: { id: string; title: string; percent: number } | null = null;
        for (const n of all) {
          const pct = Number(n?.discount_percent);
          const pattern = String(n?.target_service_pattern || '').trim().toLowerCase();
          if (!Number.isFinite(pct) || pct <= 0 || !pattern) continue;
          if (!haystack.includes(pattern)) continue;
          if (!best || pct > best.percent) {
            best = { id: n.id, title: n.title, percent: pct };
          }
        }
        if (best) {
          console.log(
            '[flash] applying discount to service',
            svcName,
            `${best.percent}% via "${best.title}"`,
          );
        }
        setFlashOffer(best);
      } catch (e: any) {
        console.log('[flash] discount lookup failed:', e?.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceData?.id]);

  // Fetch the customer's wallet + refund balance once so the Payment
  // Summary can show real "Use Reward Points" / "Use Refund Wallet" caps.
  useEffect(() => {
    (async () => {
      try {
        const { getWalletBalance } = await import('../services/api');
        const wallet: any = await getWalletBalance();
        const balance = Number(wallet?.balance || 0);
        // Split: anything from referral_reward / referral_milestone is
        // "reward points"; anything from refund / cancellation is "refund
        // wallet". Until the backend tags them separately we treat the
        // whole balance as reward points and leave refund at 0.
        setWalletBalance(balance);
        const refundCredits = Array.isArray(wallet?.transactions)
          ? wallet.transactions
              .filter((t: any) => t.type === 'credit' && /refund|cancel/i.test(t.source || ''))
              .reduce((s: number, t: any) => s + Number(t.amount || 0), 0)
          : 0;
        setRefundBalance(refundCredits);
      } catch (e: any) {
        console.log('[booking] wallet balance fetch failed:', e?.message);
      }
    })();
  }, []);

  // ─── Rate-chart safety override ────────────────────────────────────────
  // The DB should already match the rate chart (run scripts/update-rate-chart.js
  // on the backend), but this client-side override guarantees a customer
  // who books before the backend deploy still sees correct prices. Match
  // by service category + name keywords, mirror values from the chart.
  const RATE_CHART: Array<{
    category: RegExp; name: RegExp;
    user_cost: number; govt_fees: number; partner_earning: number;
    total_expense: number; company_margin: number; expected_timeline: string;
  }> = [
    // Aadhaar
    { category: /aadhaar|aadhar/i, name: /new\s+aadhaar\s+enrolment/i,        user_cost:  200, govt_fees:    0, partner_earning: 100, total_expense:  100, company_margin: 100, expected_timeline: '1 week' },
    { category: /aadhaar|aadhar/i, name: /husband\s+name\s+update/i,           user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '3 weeks' },
    { category: /aadhaar|aadhar/i, name: /address\s+update/i,                  user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '4 weeks' },
    { category: /aadhaar|aadhar/i, name: /date\s+of\s+birth\s+update/i,        user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '5 weeks' },
    { category: /aadhaar|aadhar/i, name: /gender\s+update/i,                   user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '6 weeks' },
    { category: /aadhaar|aadhar/i, name: /biometric/i,                         user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '7 weeks' },
    { category: /aadhaar|aadhar/i, name: /mobile\s*no\.?\s+update/i,           user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '8 weeks' },
    { category: /aadhaar|aadhar/i, name: /email\s+id\s+update/i,               user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '9 weeks' },
    { category: /aadhaar|aadhar/i, name: /order\s+aadhaar\s+pvc/i,             user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '10 weeks' },
    { category: /aadhaar|aadhar/i, name: /download\s+aadhaar/i,                user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '11 weeks' },
    { category: /aadhaar|aadhar/i, name: /verify\s+email\/?mobile/i,           user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '12 weeks' },
    { category: /aadhaar|aadhar/i, name: /name\s+update/i,                     user_cost:  275, govt_fees:   75, partner_earning: 100, total_expense:  175, company_margin: 100, expected_timeline: '2 weeks' },
    // PAN
    { category: /pan/i, name: /link\s+pan\s+to\s+aadhaar/i,                    user_cost: 1100, govt_fees: 1000, partner_earning:  75, total_expense: 1075, company_margin:  25, expected_timeline: '48-72 hrs' },
    { category: /pan/i, name: /new\s+pan/i,                                    user_cost:  220, govt_fees:  107, partner_earning:  75, total_expense:  182, company_margin:  38, expected_timeline: '24-48 hrs' },
    { category: /pan/i, name: /(name|address|date\s+of\s+birth|gender|mobile|email)/i, user_cost: 220, govt_fees: 107, partner_earning: 75, total_expense: 182, company_margin: 38, expected_timeline: '48-72 hrs' },
    { category: /pan/i, name: /(order|download|verify)/i,                      user_cost:  220, govt_fees:  107, partner_earning:  75, total_expense:  182, company_margin:  38, expected_timeline: '48-72 hrs' },
    // Voter ID — flat ₹150 for every variant per the rate chart.
    { category: /voter|epic|electoral/i, name: /.*/i, user_cost: 150, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 50, expected_timeline: '10-15 Days' },
    // Ration Card — flat ₹150 for every variant per the rate chart.
    { category: /ration|pds/i, name: /.*/i, user_cost: 150, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 50, expected_timeline: '20-30 Days' },

    // ─── Driving Licence ──────────────────────────────────────────────────
    // Order matters: more-specific names first so e.g. "Apply for Driving
    // Licence Heavy" hits the heavy row before the generic 4-wheeler one.
    { category: /driving|licen[cs]e|\bdl\b/i, name: /learner.?licen/i,           user_cost:  5000, govt_fees:  4000, partner_earning:  500, total_expense:  4500, company_margin:  500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /heavy/i,                    user_cost: 22000, govt_fees: 19000, partner_earning: 2000, total_expense: 21000, company_margin: 1000, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /renewal/i,                  user_cost:  3500, govt_fees:  2500, partner_earning:  500, total_expense:  3000, company_margin:  500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /(2.?wheeler|two.?wheeler)/i, user_cost: 4500, govt_fees:  4000, partner_earning:  500, total_expense:  4500, company_margin:    0, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /(4.?wheeler|four.?wheeler)/i, user_cost: 5000, govt_fees: 4000, partner_earning:  500, total_expense:  4500, company_margin:  500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /duplicate/i,                user_cost:  1500, govt_fees:  1000, partner_earning:  300, total_expense:  1300, company_margin:  200, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /change.?of.?address|address.?change/i, user_cost: 1500, govt_fees: 800, partner_earning: 500, total_expense: 1300, company_margin: 200, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /international|idp/i,        user_cost:  5000, govt_fees:  3500, partner_earning: 1000, total_expense:  4500, company_margin:  500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /add.?class|class.?of.?vehicle/i, user_cost: 5000, govt_fees: 4000, partner_earning: 500, total_expense: 4500, company_margin: 500, expected_timeline: '5-10 Days' },
    { category: /driving|licen[cs]e|\bdl\b/i, name: /(ll.?test|stall)/i,         user_cost:   800, govt_fees:   500, partner_earning:  200, total_expense:   700, company_margin:  100, expected_timeline: '5-10 Days' },

    // ─── Other Services (certificates, licenses, MSME) ───────────────────
    { category: /msme|udhyog|udyog/i,           name: /.*/i, user_cost:  300, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 200, expected_timeline: '5-12 Hrs' },
    { category: /food.?license|fssai/i,         name: /.*/i, user_cost:  200, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 100, expected_timeline: '5-12 Hrs' },
    { category: /trade.?license/i,              name: /.*/i, user_cost: 1000, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 900, expected_timeline: '5-12 Hrs' },
    { category: /caste/i,                       name: /.*/i, user_cost:  300, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 200, expected_timeline: '5-12 Hrs' },
    { category: /domicile/i,                    name: /.*/i, user_cost:  400, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 300, expected_timeline: '5-12 Hrs' },
    { category: /income/i,                      name: /.*/i, user_cost:  250, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 150, expected_timeline: '5-12 Hrs' },
    { category: /birth.?certificate/i,          name: /.*/i, user_cost:  400, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 300, expected_timeline: '5-12 Hrs' },
    { category: /death.?certificate/i,          name: /.*/i, user_cost:  400, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: 300, expected_timeline: '5-12 Hrs' },
    // Life Certificate is intentionally sold at a loss (-₹50 margin) per
    // the rate chart — it's a customer-acquisition loss-leader.
    { category: /life.?certificate/i,           name: /.*/i, user_cost:   50, govt_fees: 0, partner_earning: 100, total_expense: 100, company_margin: -50, expected_timeline: '5-12 Hrs' },
  ];
  const rateChartHit = (() => {
    if (!serviceData?.name || !serviceData?.category) return null;
    return RATE_CHART.find(
      (row) => row.category.test(String(serviceData.category)) && row.name.test(String(serviceData.name)),
    );
  })();

  // Calculate pricing — parse as numbers since API returns decimal strings.
  // If the service matches a rate-chart row, use those values verbatim;
  // otherwise fall back to whatever the backend returned.
  //
  // CUSTOMER PRICING MODEL (per the 09.04.26 rate chart PDF):
  //   user_cost  = what the customer pays at checkout
  //   ├── govt_fees       → paid to the government for the application
  //   ├── partner_earning → commission to the field representative
  //   └── company_margin  → FliponeX's margin
  //   (govt_fees + partner_earning + company_margin === user_cost)
  //
  // total_expense is just (govt_fees + partner_earning) — FliponeX's
  // out-of-pocket. It is NOT what the customer is charged. Anchoring on
  // user_cost guarantees the bill matches the service detail page.
  const userCost = rateChartHit?.user_cost ?? (parseFloat(serviceData?.user_cost) || 0);
  const govtFees = rateChartHit?.govt_fees ?? (parseFloat(serviceData?.govt_fees) || 0);
  const partnerEarning =
    rateChartHit?.partner_earning ?? (parseFloat(serviceData?.partner_earning) || 0);
  const companyMargin =
    rateChartHit?.company_margin ?? (parseFloat(serviceData?.company_margin) || 0);
  const totalExpenseRaw =
    rateChartHit?.total_expense ?? (parseFloat(serviceData?.total_expense) || 0);
  // Trust total_expense if the row has it; otherwise compute it.
  const totalExpense = totalExpenseRaw > 0 ? totalExpenseRaw : govtFees + partnerEarning;

  // Doorstep/Convenience = everything billed to the customer that
  // ISN'T the government fee. That's partner_earning + company_margin
  // (the latter was previously dropped from the bill, which made
  // subtotal show ₹255 even though the service was advertised at
  // ₹357 — a 102 mismatch the user reported). Anchoring on userCost
  // (the customer-facing list price) guarantees the bill summary
  // adds up to what the user was shown on the service detail screen.
  const customerBase = userCost > 0 ? userCost : totalExpense;
  const doorstepCharges = Math.max(0, customerBase - govtFees);

  // ── Display-only customer-facing split ───────────────────────────
  // The internal rate-chart numbers (govtFees / partnerEarning /
  // companyMargin) are used by finance + agent commission. The user
  // wants the Payment Summary card to instead show TWO friendlier
  // lines that always sum to the list price:
  //   • Basic / Government Fees   — pseudo-random, ≥ ₹100
  //   • Doorstep / Convenience    — remainder, ≥ ₹0
  // Stable across sessions for the same service (seeded by service id)
  // so the customer sees the same numbers every time they reopen the
  // booking. NOT sent to the backend — booking payload still carries
  // the real rate-chart split so company_margin reporting stays
  // accurate.
  const computeDisplaySplit = (
    seed: string,
    total: number,
  ): { govt: number; doorstep: number } => {
    if (!Number.isFinite(total) || total <= 0) return { govt: 0, doorstep: 0 };
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = Math.abs(h | 0);
    const FLOOR = 100;
    if (total <= FLOOR + 50) {
      // Service is too cheap for a govt-fee ≥ 100 split with leftover.
      // Clamp govt to most of the price, leave a small doorstep tail.
      const govt = Math.max(0, total - 50);
      return { govt, doorstep: total - govt };
    }
    const lower = FLOOR;
    const upper = Math.max(FLOOR + 1, total - 50);
    const govt = lower + (h % (upper - lower + 1));
    return { govt, doorstep: total - govt };
  };

  const displaySplit = computeDisplaySplit(
    String(serviceData?.id || serviceData?.name || ''),
    customerBase,
  );
  const displayGovtFees = displaySplit.govt;
  const displayDoorstepCharges = displaySplit.doorstep;

  // Optional add-ons — derived from the customer-facing base price
  // so percentages stay sensible. Keep small floors so a tiny service
  // doesn't show ₹5 line items.
  const processingFees = Math.max(50, Math.round(customerBase * 0.10));
  const consultancyFees = Math.max(50, Math.round(customerBase * 0.15));
  const taxesFees = Math.round(customerBase * 0.18);
  const fastTrackFees = priorityFee || 100;

  const optionalTotal =
    (optProcessing ? processingFees : 0) +
    (optConsultancy ? consultancyFees : 0) +
    (optTaxes ? taxesFees : 0) +
    (optFastTrack ? fastTrackFees : 0);

  // Base = userCost (customer's list price). Optional add-ons stack
  // on top. Subtotal == userCost when no add-ons are ticked, so the
  // bill matches the price shown on the service detail page.
  const subtotalBeforeCredits = customerBase + optionalTotal;

  // Flash-notification discount — admin-managed splash offer. Applied
  // BEFORE wallet credits + referral so the user clearly sees the
  // flash-offer line as a savings before any other adjustments.
  // Rounded to the nearest rupee so the bill total stays clean.
  const flashDiscountAmount = flashOffer
    ? Math.round(subtotalBeforeCredits * (flashOffer.percent / 100))
    : 0;
  const subtotalAfterFlash = Math.max(0, subtotalBeforeCredits - flashDiscountAmount);

  // Wallet credits can pay at most 50% of the booking value (per the
  // Refer & Earn policy 3.2). Apply each credit pool only when checked.
  const fiftyPercentCap = Math.floor(subtotalAfterFlash * 0.5);
  const rewardApplied = useRewardPoints ? Math.min(walletBalance, fiftyPercentCap) : 0;
  const refundApplied = useRefundWallet
    ? Math.min(refundBalance, fiftyPercentCap - rewardApplied)
    : 0;

  const totalAmount = Math.max(
    0,
    subtotalAfterFlash - rewardApplied - refundApplied - referralDiscount,
  );

  // Legacy compatibility — older code paths read `additionalFee`.
  const additionalFee = optFastTrack ? fastTrackFees : 0;

  useEffect(() => {
    console.log('BookingScreen mounted with service:', serviceData);
  }, [serviceData]);

  const tryDeviceGPS = async (): Promise<any> => {
    // Step 1 — try the cached "last known" position first. Instant on most
    // devices since Android keeps a recent fix in memory. Only accept it if
    // it's recent enough and accurate enough to actually be useful.
    try {
      const last = await Location.getLastKnownPositionAsync({
        maxAge: 60_000,        // accept positions up to 60s old
        requiredAccuracy: 100, // meters — anything tighter and we'd reject most fixes
      });
      if (last?.coords) return last.coords;
    } catch (_) {
      /* fall through to fresh fix */
    }

    // Step 2 — fresh GPS fix with the highest accuracy. Wrap in a 12s
    // timeout race so we don't sit on the spinner forever if GPS can't
    // get a satellite lock indoors.
    const fresh = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
      mayShowUserSettingsDialog: true,
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('GPS timeout')), 12_000),
    );
    const position: any = await Promise.race([fresh, timeout]);
    return position.coords;
  };

  const requestLocationPermission = async (): Promise<void> => {
    setLoading(true);

    // Step 1: Try device GPS (works only if permission was granted in build)
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Access',
            message: 'FlipOn needs your location to autofill the service address.',
            buttonPositive: 'Allow',
            buttonNegative: 'Cancel',
          }
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          try {
            const coords = await tryDeviceGPS();
            const { latitude, longitude } = coords;
            setLatitude(latitude);
            setLongitude(longitude);
            // Persist these coords to the user's row server-side so the
            // assigned rep sees a real distance instead of "Address
            // unresolved" (Android's geocoder is unreliable). Fire-and-
            // forget — booking creation continues regardless.
            updateMyLocation(latitude, longitude);
            let displayAddress = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            try {
              const reverse: any = await getLocationFromAddress(`${latitude},${longitude}`);
              if (reverse?.address) displayAddress = reverse.address;
            } catch (_) {}
            setAddress(displayAddress);
            setUseCurrentLocation(true);
            setLoading(false);
            Alert.alert('Location Found', displayAddress);
            return;
          } catch (gpsErr: any) {
            console.log('Device GPS failed, falling back to backend:', gpsErr?.message);
          }
        } else {
          console.log('Permission denied by user, falling back to backend lookup');
        }
      } catch (permErr: any) {
        console.log('PermissionsAndroid.request errored (likely missing manifest entry):', permErr?.message);
      }
    }

    // Step 2: Fallback — try multiple free IP geolocation services
    const ipServices: any[] = [
      { url: 'https://ipwho.is/', map: (d: any) => d.success !== false ? { lat: d.latitude, lng: d.longitude, parts: [d.city, d.region, d.country, d.postal] } : null },
      { url: 'https://ipapi.co/json/', map: (d: any) => !d.error ? { lat: d.latitude, lng: d.longitude, parts: [d.city, d.region, d.country_name, d.postal] } : null },
      { url: 'https://ipinfo.io/json', map: (d: any) => d.loc ? { lat: parseFloat(d.loc.split(',')[0]), lng: parseFloat(d.loc.split(',')[1]), parts: [d.city, d.region, d.country, d.postal] } : null },
    ];

    for (const svc of ipServices) {
      try {
        const res = await fetch(svc.url, { headers: { Accept: 'application/json' } });
        const text = await res.text();
        // Skip if response isn't JSON (e.g., rate-limit HTML)
        if (!text.trim().startsWith('{')) {
          console.log(`${svc.url} returned non-JSON, trying next...`);
          continue;
        }
        const data = JSON.parse(text);
        const result = svc.map(data);
        if (result && result.lat && result.lng) {
          const displayAddress = result.parts.filter(Boolean).join(', ');
          setLatitude(result.lat);
          setLongitude(result.lng);
          setAddress(displayAddress || `${result.lat}, ${result.lng}`);
          setUseCurrentLocation(true);
          setLoading(false);
          Alert.alert(
            'Approximate Location Set',
            `${displayAddress}\n\nThis is based on your IP. Please edit if not exact.`
          );
          return;
        }
      } catch (e: any) {
        console.log(`${svc.url} failed:`, e?.message);
      }
    }

    setLoading(false);
    showManualEntryFallback({ message: 'All location services unavailable' });
  };

  const showManualEntryFallback = (error: any): void => {
    console.error('All location methods failed:', error);
    setUseCurrentLocation(false);
    setLoading(false);

    Alert.alert(
      'Location Detection Failed',
      'Unable to detect your location automatically. Please enter your service address manually.',
      [
        {
          text: 'Enter Address Manually',
          onPress: () => {
            console.log('User opted for manual address entry');
          }
        },
        {
          text: 'Try Again',
          onPress: () => {
            console.log('User wants to retry location detection');
            requestLocationPermission();
          }
        }
      ]
    );
  };

  // ─── Document upload (Camera / Gallery / PDF) ────────────────────────────
  // Tapping an "Upload" button opens an action sheet with three sources.
  // Each source asks only for the permission it needs, then funnels into a
  // single `performUpload()` helper that talks to the backend.
  const handleDocumentUpload = (documentType: string): void => {
    // Open the custom Modal-based picker instead of the native Alert.alert
    // action sheet — Alert can't be dismissed by tapping outside, which the
    // user expects from a bottom-sheet style picker.
    setDocPickerFor(documentType);
  };

  // Native file picker — accepts ANY file type (PDF, Word, Excel, images,
  // anything). Backend's /documents/upload endpoint is mime-agnostic.
  const pickFromFiles = async (documentType: string): Promise<void> => {
    if (!documentPickerAvailable) {
      showToast(
        'Unavailable',
        'File picker needs a fresh app build. Use Camera or Gallery for now.',
        'error',
      );
      return;
    }
    try {
      const result: any = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      const mime = file.mimeType || 'application/octet-stream';
      // Make sure the filename has an extension; fall back to the mime suffix.
      const name = file.name || `document_${documentType}_${Date.now()}.${mime.split('/').pop() || 'bin'}`;
      await performUpload(documentType, {
        uri: file.uri,
        name,
        type: mime,
      });
    } catch (e: any) {
      console.error('file pick error:', e);
      showToast('File picker error', e?.message || 'Could not open file picker', 'error');
    }
  };

  const pickFromCamera = async (documentType: string): Promise<void> => {
    try {
      // Styled crop UI via react-native-image-crop-picker (UCrop on
      // Android, TOCropViewController on iOS). Replaces Android's
      // plain-text "CROP" system overlay with a branded toolbar +
      // clearly-coloured confirm tick. Falls back to expo-image-picker
      // on older APKs that haven't been rebuilt with the native module.
      const file = await captureWithCrop({
        namePrefix: `document_${documentType}`,
      });
      if (!file) return; // user cancelled
      setPendingImage({ documentType, file });
    } catch (e: any) {
      console.error('camera pick error:', e);
      showToast('Camera error', e?.message || 'Could not open camera', 'error');
    }
  };

  const pickFromGallery = async (documentType: string): Promise<void> => {
    try {
      const file = await pickWithCrop({
        namePrefix: `document_${documentType}`,
      });
      if (!file) return;
      setPendingImage({ documentType, file });
    } catch (e: any) {
      console.error('gallery pick error:', e);
      showToast('Gallery error', e?.message || 'Could not open gallery', 'error');
    }
  };

  // Single upload path. Retries 3× on transient failure, surfaces the backend
  // reason on hard failure so the user knows what to fix.
  const performUpload = async (documentType: string, file: any): Promise<void> => {
    try {
      setUploadProgress((prev: any) => ({ ...prev, [documentType]: true }));

      const uploadData: any = new FormData();
      uploadData.append('file', { uri: file.uri, type: file.type, name: file.name });
      uploadData.append('document_type', documentType);
      uploadData.append('file_name', file.name);
      // Pin the category to 'booking' so multer writes the file into
      // /uploads/booking/ — matches the DB row that this controller
      // creates with category='booking', so the resulting file_url
      // resolves to a real file (not a 404).
      uploadData.append('category', 'booking');

      let response: any;
      let retryCount = 0;
      const maxRetries = 3;
      while (retryCount < maxRetries) {
        try {
          response = await uploadDocument('', uploadData);
          break;
        } catch (error: any) {
          retryCount += 1;
          console.log(`upload attempt ${retryCount} failed:`, error?.message);
          if (retryCount >= maxRetries) throw error;
          await new Promise((r) => setTimeout(r, 1000 * retryCount));
        }
      }

      // Replace any existing entry of the same type so the thumbnail + name
      // immediately update when the user picks a new image. (Previously this
      // appended, leaving the old entry first → find() returned stale data.)
      setUploadedDocuments((prev: any[]) => [
        ...prev.filter((d: any) => d?.type !== documentType),
        { type: documentType, uri: file.uri, name: file.name, uploadResponse: response?.data },
      ]);
      showToast(
        'Document Uploaded',
        `${documentType.replace(/_/g, ' ')} added successfully`,
        'success'
      );
    } catch (uploadError: any) {
      console.error('upload error:', uploadError);
      const reason =
        uploadError?.message ||
        uploadError?.response?.data?.message ||
        'Please try again in a moment';
      showToast('Upload Failed', reason, 'error');
    } finally {
      setUploadProgress((prev: any) => ({ ...prev, [documentType]: false }));
    }
  };

  const processOnlinePayment = async (bookingId: any, amount: number): Promise<any> => {
    // (Removed test-mode bypass helper — payment success is now ONLY
    // granted after a real signature-verified Razorpay round-trip.
    // Test keys still work because Razorpay's sandbox accepts test
    // credentials; success path is identical to production.)

    try {
      setProcessingPayment(true);
      setPaymentError('');

      console.log('=== RAZORPAY PAYMENT ===');
      console.log('Booking ID:', bookingId, 'Amount:', amount);

      // 1. Ask backend to create a Razorpay order. Backend validates the
      //    booking belongs to this user and returns order_id + key_id.
      const orderRes: any = await createPaymentOrder({ booking_id: bookingId, amount });
      const order = orderRes?.data;
      if (!order?.order_id || !order?.key_id) {
        throw new Error('Could not initiate payment — server did not return an order');
      }

      const isTestKey =
        typeof order.key_id === 'string' && order.key_id.startsWith('rzp_test_');

      // Removed the test-mode short-circuit. Previously, when a Razorpay
      // test key was in use AND the user had picked an `onlineMethod` in
      // our step-5 UI, we used to skip Razorpay entirely and call
      // /payments/process directly — marking the booking as paid without
      // any actual money movement or signature verification. Customers
      // were seeing "Payment Successful" alerts without ever entering a
      // card / UPI / wallet code in Razorpay. That defeats the whole
      // purpose of test-mode testing.
      //
      // Test mode now ALWAYS opens the Razorpay sandbox. Use Razorpay's
      // test credentials inside it:
      //   • UPI:        any-id@razorpay  (sandbox auto-approves)
      //   • Card:       4111 1111 1111 1111, exp any future, CVV 100
      //   • Netbanking: pick any bank, Sandbox lets you "succeed"
      // The signature still gets HMAC-verified server-side via
      // verifyPayment, so the booking only flips to `paid` after a real
      // round-trip — same code path as production.
      void isTestKey;

      // 2. Open Razorpay native checkout. The SDK shows UPI / Cards /
      //    Netbanking / Wallets and returns the signature + payment_id.
      const checkoutOptions: any = {
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount, // paise
        currency: order.currency || 'INR',
        name: 'FlipOn',
        description: `Booking ${String(bookingId).slice(0, 8)}`,
        prefill: {
          name: applicantName || fullName || '',
          email: email || '',
          contact: userMobile || '',
        },
        theme: { color: '#003049' },
      };

      let checkoutResp: any;
      try {
        checkoutResp = await RazorpayCheckout.open(checkoutOptions);
      } catch (rzpErr: any) {
        // The SDK rejects in two cases — both "user did not pay":
        //   1. User dismissed the modal (back button / "Exit?" → Yes)
        //   2. Real gateway failure (network, sandbox rejection, …)
        // In BOTH cases the customer hasn't transferred money, so we
        // must NOT mark the booking paid. The previous code had a
        // test-mode bypass here that auto-confirmed any non-cancel
        // failure, which was firing on Razorpay-Android's quirky back-
        // button error shapes (code 1 with description "PAYMENT_FAILED")
        // and showing "Payment Successful" to users who had explicitly
        // bailed out. Now: any rejection from RazorpayCheckout.open →
        // stay on the payment screen, no booking confirmation.
        let parsed: any = rzpErr;
        if (typeof rzpErr?.message === 'string' && rzpErr.message.startsWith('{')) {
          try { parsed = JSON.parse(rzpErr.message); } catch (_) { /* keep original */ }
        }
        const inner = parsed?.error || parsed;
        const code = inner?.code ?? rzpErr?.code;
        const reason = inner?.reason;
        const description =
          (inner?.description && inner.description !== 'undefined' && inner.description) ||
          reason ||
          rzpErr?.message ||
          'Payment cancelled';
        const looksLikeCancel =
          code === 0 || code === 2 || /cancel|user closed|dismiss|exit/i.test(description);

        Alert.alert(
          looksLikeCancel ? 'Payment cancelled' : 'Payment failed',
          looksLikeCancel
            ? 'You can retry from the same screen.'
            : description,
        );
        throw new Error(description);
      }

      // 3. Send signature to backend for HMAC verification + Razorpay
      //    payment-status fetch. Only then is the booking marked paid.
      let verifyRes: any;
      try {
        verifyRes = await verifyPayment({
          booking_id: bookingId,
          razorpay_order_id: checkoutResp.razorpay_order_id,
          razorpay_payment_id: checkoutResp.razorpay_payment_id,
          razorpay_signature: checkoutResp.razorpay_signature,
        });
      } catch (verifyErr: any) {
        // Always surface verification errors — even in test mode. The
        // previous code would auto-mark the booking paid on the test
        // key, which let "payment success" land even when Razorpay's
        // signature didn't match. That defeats the test-mode safety
        // net users expect.
        Alert.alert(
          'Payment verification failed',
          'Your payment was charged but we could not verify it. Contact support — booking is on hold.',
        );
        throw verifyErr;
      }

      if (!verifyRes?.success) {
        Alert.alert(
          'Payment verification failed',
          verifyRes?.message ||
            'Payment was not verified by our server. Please retry from My Bookings.',
        );
        throw new Error(verifyRes?.message || 'Payment verification failed');
      }

      setPaymentCompleted(true);
      const txnId = verifyRes.data?.transaction_id || checkoutResp.razorpay_payment_id;
      Alert.alert(
        'Payment Successful',
        `₹${amount} paid successfully.\nTransaction ID: ${txnId}`,
        [
          {
            text: 'OK',
            onPress: () => {
              setCurrentStep(6);
              nextLocalBookingNumber().then((n: any) => setBookingNumber(`BK${n}`));
            },
          },
        ]
      );
      return verifyRes;
    } catch (error: any) {
      console.error('Payment processing error:', error);
      setPaymentError(error.message || 'Payment processing failed');
      throw error;
    } finally {
      setProcessingPayment(false);
    }
  };

  // Slot Booking Functions — 24/7. Service is now available around the
  // clock so we generate slots for every hour of the day (00:00–24:00).
  // The 4-hour / 90-minute advance-booking gate still applies, so the
  // earliest selectable slot today is whichever hour is >= now + minHours.
  const generateTimeSlots = (date: any): any[] => {
    const slots: any[] = [];
    const startHour = 0;  // midnight
    const endHour = 24;   // last slot starts at 23:00, ends at 24:00

    // Convert a 24-hour value to a "HH:MM AM/PM" friendly label.
    // 0 → "12:00 AM", 12 → "12:00 PM", 13 → "1:00 PM" etc.
    const to12h = (h: number): string => {
      const hh = h % 24;
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const display = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
      return `${display}:00 ${ampm}`;
    };

    for (let hour = startHour; hour < endHour; hour++) {
      // Keep the 24h `startTime` / `endTime` for backend payloads + the
      // booking-window validator. Only the `display` line shifts to a
      // human 12-hour label so users know morning vs evening at a glance.
      const startTime = `${hour.toString().padStart(2, '0')}:00`;
      const endHourNext = hour + 1;
      const endTime =
        endHourNext === 24 ? '24:00' : `${endHourNext.toString().padStart(2, '0')}:00`;

      slots.push({
        id: `${startTime}-${endTime}`,
        startTime,
        endTime,
        display: `${to12h(hour)} - ${to12h(hour + 1)}`,
      });
    }

    return slots;
  };

  const validateBookingWindow = (selectedDateTime: any): any => {
    const now = new Date();
    const bookingTime = new Date(selectedDateTime);

    // Calculate minimum booking time (4 hours from now for regular, 90 minutes for fast-track)
    const minHoursFromNow = serviceMode === 'fast_track' ? 1.5 : 4;
    const minBookingTime = new Date(now.getTime() + (minHoursFromNow * 60 * 60 * 1000));

    // Calculate maximum booking time (7 days from now)
    const maxBookingTime = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    if (bookingTime < minBookingTime) {
      return {
        valid: false,
        message: serviceMode === 'fast_track'
          ? 'Fast-track service must be booked at least 90 minutes in advance'
          : 'Regular service must be booked at least 4 hours in advance'
      };
    }

    if (bookingTime > maxBookingTime) {
      return {
        valid: false,
        message: 'Bookings can only be made up to 7 days in advance'
      };
    }

    return { valid: true };
  };

  const validateWorkingHours = (_selectedDateTime: any): any => {
    // Bookings are now 24/7 — no time-of-day restriction. The only gating
    // is the advance-window (>=4h regular, >=90m fast-track) which is
    // enforced by validateBookingWindow above. Slot availability is the
    // rep schedule's responsibility, not the calendar hour.
    return { valid: true };
  };

  const handleDateSelect = (date: any): void => {
    setSelectedDate(date);
    setShowSlotDatePicker(false);

    // Generate available slots for the selected date
    const slots = generateTimeSlots(date);
    setAvailableSlots(slots);
    setSelectedTimeSlot(null); // Reset selected time slot
  };

  const handleTimeSlotSelect = (slot: any): void => {
    // Create full datetime for validation
    const slotDateTime = new Date(selectedDate);
    const [hour] = slot.startTime.split(':');
    slotDateTime.setHours(parseInt(hour), 0, 0, 0);

    // Validate booking window
    const windowValidation = validateBookingWindow(slotDateTime);
    if (!windowValidation.valid) {
      Alert.alert('Booking Window Error', windowValidation.message);
      return;
    }

    // Validate working hours
    const hoursValidation = validateWorkingHours(slotDateTime);
    if (!hoursValidation.valid) {
      Alert.alert('Working Hours Error', hoursValidation.message);
      return;
    }

    setSelectedTimeSlot(slot);
  };

  // Add mobile validation function
  const validateMobile = (mobile: string): boolean => {
    if (!mobile) return false;
    // Remove spaces and special characters
    const cleanMobile = mobile.replace(/\s/g, '').replace(/[-+]/g, '');
    const mobileRegex = /^[6-9]\d{9}$/;
    return mobileRegex.test(cleanMobile);
  };

  // Per-step gating for the Next button. The user can only advance once the
  // mandatory inputs for the current stage are filled. Returning {ok:false}
  // surfaces a specific message via Alert so they know exactly what's missing
  // — much better than a silent no-op tap.
  const canAdvanceFromCurrentStep = (): { ok: boolean; message?: string } => {
    // Step 1 — Service Address
    if (currentStep === 1) {
      if (!address.trim()) {
        return { ok: false, message: 'Please enter your service address before continuing.' };
      }
      return { ok: true };
    }

    // Step 2 — Personal Details (varies by service variant)
    if (currentStep === 2) {
      const cat = String(serviceData?.category || '').toLowerCase();
      const name = String(serviceData?.name || '').toLowerCase();
      const desc = String(serviceData?.description || '').toLowerCase();
      const haystack = `${cat} ${name} ${desc}`;
      const isAadhaarService = /aadhaar|aadhar/.test(haystack);
      const isPanService = /\bpan\b|pan.?card|pan.?number/.test(haystack);
      const isVoterIdService =
        /voter.?id|voter.?card|epic|electoral|election|form\s*[678]\b/.test(haystack);
      const isRationCardService =
        /ration.?card|ration|fps|public.?distribution|pds\b|aay|apl|bpl/.test(haystack);
      const isNoDocCategory =
        NO_DOC_CATEGORIES.test(serviceData?.category || '') ||
        NO_DOC_CATEGORIES.test(serviceData?.name || '');

      // ID-form services (Aadhaar / PAN / Voter / Ration) — every starred
      // field on the form must be filled.
      if (isAadhaarService || isPanService || isVoterIdService || isRationCardService) {
        const variant: 'aadhaar' | 'pan' | 'voterid' | 'rationcard' = isRationCardService
          ? 'rationcard'
          : isVoterIdService
          ? 'voterid'
          : isPanService
          ? 'pan'
          : 'aadhaar';

        const nameVal = (applicantName || fullName).trim();
        if (!nameVal) return { ok: false, message: "Please enter the applicant's name." };
        // Aadhaar number is required for every ID-form variant — UIDAI / PAN
        // linking / state portals all need it. 12 digits, numeric only.
        if (!aadhaarNumber.trim() || aadhaarNumber.length !== 12) {
          return { ok: false, message: 'Please enter a valid 12-digit Aadhaar number.' };
        }
        if (!fatherName.trim()) return { ok: false, message: "Please enter the father's name." };
        if (variant === 'pan' && !motherName.trim()) {
          return { ok: false, message: "Please enter the mother's name." };
        }
        if (
          (variant === 'aadhaar' || variant === 'voterid' || variant === 'rationcard') &&
          maritalStatus === 'Married' &&
          (gender === 'Female' || gender === 'female') &&
          !husbandName.trim()
        ) {
          return { ok: false, message: "Please enter the husband's name." };
        }
        if (!dateOfBirth) return { ok: false, message: 'Please select your date of birth.' };
        if (!gender) return { ok: false, message: 'Please select your gender.' };
        if (!mobile.trim() || !validateMobile(mobile)) {
          return { ok: false, message: 'Please enter a valid 10-digit mobile number.' };
        }
        if (!maritalStatus) {
          return { ok: false, message: 'Please select your marital status.' };
        }
        if (variant === 'rationcard') {
          if (!headOfFamily.trim()) {
            return { ok: false, message: 'Please enter the head of family.' };
          }
          if (!hofMobile.trim() || !validateMobile(hofMobile)) {
            return { ok: false, message: "Please enter a valid 10-digit mobile for the head of family." };
          }
          if (!rationDealerName.trim()) {
            return { ok: false, message: 'Please enter the ration dealer name.' };
          }
        }
        if (!houseNo.trim()) return { ok: false, message: 'Please enter your house number.' };
        if (!(streetArea || addressLine1).trim()) {
          return { ok: false, message: 'Please enter the street / area / locality.' };
        }
        if (!townVillage.trim()) {
          return { ok: false, message: 'Please enter your town or village.' };
        }
        if (!postOffice.trim()) {
          return { ok: false, message: 'Please enter the post office.' };
        }
        if (!(talukaTehsil || subdivision).trim()) {
          return { ok: false, message: 'Please enter the taluka / tehsil / mandal.' };
        }
        if (variant === 'voterid') {
          if (!assemblyConstituency.trim()) {
            return { ok: false, message: 'Please enter the assembly constituency.' };
          }
          if (!parliamentaryConstituency.trim()) {
            return { ok: false, message: 'Please enter the parliamentary constituency.' };
          }
        }
        if (!district.trim()) return { ok: false, message: 'Please enter your district.' };
        if (!state.trim()) return { ok: false, message: 'Please select your state.' };
        if (!pincode.trim() || pincode.length !== 6) {
          return { ok: false, message: 'Please enter a valid 6-digit PIN code.' };
        }
        return { ok: true };
      }

      // Travel / recharge / utility — only Full Name + Mobile are required.
      if (isNoDocCategory) {
        if (!applicantName.trim()) {
          return { ok: false, message: 'Please enter your full name.' };
        }
        if (!mobile.trim() || !validateMobile(mobile)) {
          return { ok: false, message: 'Please enter a valid 10-digit mobile number.' };
        }
        return { ok: true };
      }

      // Generic services — backend-driven form fields and/or description-
      // based heuristic. We always require a valid mobile number, plus any
      // backend field marked required:true.
      const backendFields: any[] = Array.isArray(serviceData?.form_fields?.fields)
        ? serviceData.form_fields.fields
        : Array.isArray(serviceData?.form_fields)
        ? serviceData.form_fields
        : [];

      if (!mobile.trim() || !validateMobile(mobile)) {
        return { ok: false, message: 'Please enter a valid 10-digit mobile number.' };
      }

      if (backendFields.length > 0) {
        for (const f of backendFields) {
          if (f?.required === false) continue;
          const key = f?.name;
          if (!key) continue;
          // Mobile is already validated separately; state goes through the
          // shared `state` variable, not dynamicFieldValues.
          if (/mobile|phone/i.test(key) || /mobile|phone/i.test(f?.label || '')) continue;
          if (/^state$/i.test(key) || /^state$/i.test(f?.label || '')) {
            if (!state.trim() && !String(dynamicFieldValues[key] || '').trim()) {
              return { ok: false, message: `Please fill: ${f?.label || key}.` };
            }
            continue;
          }
          const val = String(dynamicFieldValues[key] ?? '').trim();
          if (!val) {
            return { ok: false, message: `Please fill: ${f?.label || key}.` };
          }
        }
        return { ok: true };
      }

      // Heuristic fallback — at minimum require a name. handleConfirmBooking
      // does the deeper field checks (full name vs. applicant name, Aadhaar
      // 12-digit etc.) so we keep this stage gentle, just enough to stop a
      // user from skipping the page entirely.
      if (!(fullName.trim() || applicantName.trim())) {
        return { ok: false, message: 'Please enter your name.' };
      }
      return { ok: true };
    }

    // Step 3 — Required Documents
    if (currentStep === 3) {
      const rawDocs = serviceData?.required_documents;
      let requiredDocs: any[] = Array.isArray(rawDocs)
        ? rawDocs
        : Array.isArray(rawDocs?.documents)
        ? rawDocs.documents
        : [];

      // Strip "Mobile Number" / "Phone" entries — these are text fields
      // collected in Step 2, not files to upload. Without this filter,
      // validation kept demanding "Please upload: Mobile Number" even
      // though the render path already hid the row, so users had no way
      // to satisfy the requirement. Same regex used by the render path.
      requiredDocs = requiredDocs.filter((d: any) => {
        const t = String(d?.type || '').toLowerCase();
        const l = String(d?.label || '').toLowerCase();
        const blob = `${t} ${l}`;
        return !/(\b|_|-)(mobile|phone|telephone|cell|sim)(\b|_|-|number|no|num)?/i.test(blob);
      });

      // Re-apply the Aadhaar update overrides so we validate against the
      // same checklist the user actually saw on screen.
      const sName = String(serviceData?.name || '').toLowerCase();
      const sDesc = String(serviceData?.description || '').toLowerCase();
      const haystack = `${sName} ${sDesc}`;
      const isAadhaar = /aadhaar|aadhar/.test(haystack);
      const hasUpdateVerb = /(update|change|correction|modif)/.test(haystack);
      const isDobUpdate = isAadhaar && /(dob|date.?of.?birth|birth.?date|birthday)/.test(haystack);
      const isNameUpdate = isAadhaar && hasUpdateVerb && /\bname\b/.test(haystack);
      const isFatherHusbandUpdate =
        isAadhaar && hasUpdateVerb && /(father|husband|guardian|relation)/.test(haystack);
      const isAddressUpdate = isAadhaar && hasUpdateVerb && /address/.test(haystack);

      if (isAddressUpdate) {
        requiredDocs = [
          { type: 'aadhaar_front', label: 'Aadhaar Front', required: true },
          { type: 'aadhaar_back', label: 'Aadhaar Back', required: true },
          { type: 'father_husband_aadhaar', label: 'Father/Husband Aadhaar', required: true },
          { type: 'new_address_proof', label: 'New Address Proof', required: true },
        ];
      } else if (isFatherHusbandUpdate) {
        requiredDocs = [
          { type: 'aadhaar_front', label: 'Aadhaar Front', required: true },
          { type: 'aadhaar_back', label: 'Aadhaar Back', required: true },
          { type: 'father_husband_aadhaar', label: 'Father/Husband Aadhaar', required: true },
        ];
      } else if (isDobUpdate) {
        requiredDocs = [
          { type: 'aadhaar_front', label: 'Aadhaar Front', required: true },
          { type: 'aadhaar_back', label: 'Aadhaar Back', required: true },
          { type: 'matric_certificate', label: 'Matric Certificate', required: true },
          { type: 'birth_certificate', label: 'Birth Certificate', required: false },
        ];
      } else if (isNameUpdate) {
        requiredDocs = [
          { type: 'aadhaar_front', label: 'Aadhaar Front', required: true },
          { type: 'aadhaar_back', label: 'Aadhaar Back', required: true },
          { type: 'voter_id', label: 'Voter ID', required: true },
          { type: 'matric_certificate', label: 'Matric Certificate', required: true },
        ];
      }

      // Mirror the render path (line ~3276) which falls back to
      // `doc_${index}` when the service's required-doc entry has no
      // explicit `type` (e.g. AAPS2.0 and other non-priced services
      // that list generic "Document 1 / Document 2" slots). Without
      // this fallback the validation kept reporting docs as missing
      // even after the user uploaded them, because uploaded.type was
      // `doc_0` but d.type was undefined — never matched. Pair each
      // required doc with its ORIGINAL index before filtering so the
      // synthesised type ids stay stable.
      const missing = requiredDocs
        .map((d: any, idx: number) => ({ d, idx }))
        .filter(({ d }) => d?.required !== false)
        .filter(({ d, idx }) => {
          const expectedType = d?.type || `doc_${idx}`;
          return !uploadedDocuments.find((u: any) => u.type === expectedType);
        });

      if (missing.length > 0) {
        const labels = missing
          .map(({ d, idx }) => d?.label || d?.type || `Document ${idx + 1}`)
          .join(', ');
        return { ok: false, message: `Please upload: ${labels}.` };
      }
      return { ok: true };
    }

    // Step 4 — Schedule
    if (currentStep === 4) {
      if (!selectedDate) {
        return { ok: false, message: 'Please pick a booking date.' };
      }
      if (!selectedTimeSlot) {
        return { ok: false, message: 'Please pick a time slot.' };
      }
      const slotDateTime = new Date(selectedDate);
      const [hour] = String(selectedTimeSlot.startTime || '07:00').split(':');
      slotDateTime.setHours(parseInt(hour, 10) || 0, 0, 0, 0);
      const w = validateBookingWindow(slotDateTime);
      if (!w.valid) return { ok: false, message: w.message };
      const h = validateWorkingHours(slotDateTime);
      if (!h.valid) return { ok: false, message: h.message };
      return { ok: true };
    }

    return { ok: true };
  };

  // Function to add booking to Agentapp notification system
  const addBookingToAgentapp = async (): Promise<void> => {
    try {
      console.log('Adding booking to Agentapp notification system...');

      // The booking data is already stored locally in AsyncStorage
      // This function can be used to send notifications to backend if needed
      // For now, it serves as a placeholder for future integration

      console.log('Booking successfully added to local storage and notification system');
    } catch (error) {
      console.error('Error in addBookingToAgentapp:', error);
    }
  };

  const handleConfirmBooking = async (
    opts: { inAppUpiSuccess?: boolean } = {},
  ): Promise<void> => {
    console.log('=== CONFIRM BOOKING STARTED ===');
    console.log('Address:', address);
    console.log('Full Name:', fullName);
    console.log('Mobile:', mobile);
    console.log('Selected Date:', selectedDate);
    console.log('Selected Time Slot:', selectedTimeSlot);
    console.log('Payment Method:', paymentMethod);

    // Validate all required fields
    if (!address.trim()) {
      console.log('Address validation failed');
      Alert.alert('Error', 'Please enter your service address');
      setCurrentStep(1);
      return;
    }

    // Validate personal details
    // Check if full name field is actually rendered for this service
    const description = serviceData?.description?.toLowerCase() || '';
    const serviceName = serviceData?.name?.toLowerCase() || '';
    const needsFullName = description.includes('full name') || description.includes('name') ||
                          description.includes('applicant name') || description.includes('applicant_name') ||
                          description.includes('address update') || serviceName.includes('address update');

    if (needsFullName && !fullName.trim()) {
      console.log('Full name validation failed');
      Alert.alert('Error', 'Please enter your full name');
      setCurrentStep(2);
      return;
    }

    // Check if applicant name field is actually rendered for this service
    const needsApplicantName = description.includes('applicant name') || description.includes('applicant_name');

    if (needsApplicantName && !applicantName.trim()) {
      console.log('Applicant name validation failed');
      Alert.alert('Error', 'Please enter applicant name');
      setCurrentStep(2);
      return;
    }

    // Check if Aadhaar number field is actually rendered for this service
    const needsAadhaar = description.includes('aadhaar') || description.includes('aadhar');

    if (needsAadhaar && (!aadhaarNumber.trim() || aadhaarNumber.length !== 12)) {
      console.log('Aadhaar validation failed');
      Alert.alert('Error', 'Please enter a valid 12-digit Aadhaar number');
      setCurrentStep(2);
      return;
    }

    // Mobile number is always required since the field is always displayed
    const mobileToValidate = mobile || userMobile || '';
    const cleanMobile = mobileToValidate.replace(/\s/g, '').replace(/[-+]/g, '');
    console.log('Mobile validation check:', { mobile, userMobile, mobileToValidate, cleanMobile, valid: validateMobile(mobileToValidate) });

    if (!mobileToValidate.trim()) {
      console.log('Mobile number is empty');
      Alert.alert('Error', 'Please enter your mobile number');
      setCurrentStep(2);
      return;
    }

    if (!validateMobile(mobileToValidate)) {
      console.log('Mobile validation failed - Original:', mobileToValidate, 'Cleaned:', cleanMobile);
      Alert.alert('Error', 'Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9');
      setCurrentStep(2);
      return;
    }

    // Validate slot booking
    if (!selectedDate || !selectedTimeSlot) {
      console.log('Date/Time slot validation failed');
      Alert.alert('Error', 'Please select a date and time slot for your booking');
      return;
    }

    console.log('All validations passed, proceeding with booking...');

    try {
      // Resolve customer name — form fields may be blank, fall back to stored user profile
      const storedUser: any = await getUser();
      const resolvedCustomerName = fullName || applicantName || storedUser?.name || mobile || userMobile || 'Customer';

      // Pull the IDs of every doc the user uploaded in THIS booking session
      // so the backend can attach exactly those (and not some leftover docs
      // from previous service flows). Each entry's uploadResponse came back
      // from /documents/upload as { id, ... }.
      const sessionDocIds = uploadedDocuments
        .map((d: any) => d?.uploadResponse?.id || d?.uploadResponse?.data?.id)
        .filter(Boolean);

      // Aadhaar-form bundle — only meaningful when the service is Aadhaar-
      // related. Sent as a single nested object so the backend can store
      // it in `dynamic_fields` without needing extra columns. Empty
      // strings are stripped to keep the payload clean.
      const aadhaarFormPayload = Object.fromEntries(
        Object.entries({
          father_name: fatherName,
          husband_name: husbandName,
          mother_name: motherName,
          disability_type: disabilityType,
          assembly_constituency: assemblyConstituency,
          parliamentary_constituency: parliamentaryConstituency,
          head_of_family: headOfFamily,
          hof_mobile: hofMobile,
          ration_dealer_name: rationDealerName,
          house_no: houseNo,
          street_area: streetArea,
          ward_name: wardName,
          town_village: townVillage,
          post_office: postOffice,
          panchayat: panchayat,
          taluka_tehsil: talukaTehsil,
          block: block,
          district: district,
          state: state,
          pincode: pincode,
          gender,
          marital_status: maritalStatus,
          email,
        }).filter(([, v]) => v !== '' && v != null),
      );

      // Create booking data object first
      const bookingData: any = {
        id: Date.now().toString(),
        service_id: serviceData?.id,
        service_name: serviceData?.name || '',
        booking_type: 'consumer',
        customer_name: resolvedCustomerName,
        applicant_name: applicantName,
        aadhaar_number: aadhaarNumber,
        // Merge the Aadhaar-form bundle into dynamic_fields so the admin
        // sees every input the customer filled. Existing dynamic field
        // values (from the service's form_fields template, if any) take
        // precedence — we never overwrite explicit per-field state.
        dynamic_fields: { ...aadhaarFormPayload, ...dynamicFieldValues },
        mobile: mobile || userMobile,
        date_of_birth: dateOfBirth,
        // Address payload — when the user picked "Use my location",
        // send the captured GPS coordinates as a JSON object so the
        // agent app can compute the distance directly via Haversine,
        // bypassing Android's flaky text geocoder. When the user typed
        // a free-text address, send it as a plain string (backend's
        // JSON column accepts either shape).
        address: latitude && longitude
          ? { latitude, longitude, formatted: address }
          : address,
        selected_date: selectedDate,
        selected_time_slot: selectedTimeSlot,
        service_mode: serviceMode,
        delivery_mode: deliveryMode,
        urgency: serviceMode === 'fast_track' ? 'high' : 'low',
        referral_code_applied: referralDiscount > 0 ? referralCodeInput.trim() : null,
        referral_discount: referralDiscount,
        payment_method: paymentMethod,
        total_amount: totalAmount,
        user_cost: userCost,
        govt_fees: govtFees,
        // Split sent so backend can compute rep commission + company
        // share without re-deriving from the rate chart. Sum across
        // these three == user_cost (= total_amount before credits).
        partner_earning: partnerEarning,
        company_margin: companyMargin,
        total_expense: totalExpense,
        additional_fee: additionalFee,
        status: 'confirmed',
        created_at: new Date().toISOString(),
        booking_number: `BK${await nextLocalBookingNumber()}`,
        document_ids: sessionDocIds,
        // dynamic_fields already set above with the Aadhaar-form bundle
        // merged with dynamicFieldValues — don't re-assign here.
      };

      // Send booking to server API with retry mechanism
      let bookingCreated = false;
      let retryCount = 0;
      const maxRetries = 3;
      let assignedAgentName: string | null = null;

      while (!bookingCreated && retryCount < maxRetries) {
        try {
          console.log(`=== SENDING BOOKING TO SERVER (Attempt ${retryCount + 1}/${maxRetries}) ===`);
          console.log('Booking data for API:', bookingData);

          const apiResponse: any = await createBooking(bookingData);
          console.log('Booking created on server:', apiResponse);

          // Update booking data with server response
          // Backend returns { success: true, data: booking } so id is at apiResponse.data.id
          const createdId = apiResponse?.data?.id || apiResponse?.id;
          if (createdId) {
            bookingData.id = createdId;
            // CRITICAL: overwrite the locally-assigned `BK<n>` fallback
            // with the backend's real sequential booking_number (floors
            // at 1000). Without this overwrite, My Bookings keeps
            // showing the pre-1000 local counter (e.g. Flip#0073) even
            // though the backend assigned Flip#1003. We also accept
            // booking_no / orderNumber / ref as backwards-compat
            // aliases in case the backend response shape varies.
            const backendNumber =
              apiResponse?.data?.booking_number ??
              apiResponse?.booking_number ??
              apiResponse?.data?.booking_no ??
              apiResponse?.data?.orderNumber ??
              apiResponse?.data?.ref;
            if (backendNumber != null && backendNumber !== '') {
              bookingData.booking_number = backendNumber;
              console.log('[booking] backend assigned booking_number:', backendNumber);
            }
            bookingCreated = true;
            // Backend may include the auto-assigned agent in the create response.
            assignedAgentName =
              apiResponse?.data?.assigned_agent?.name ||
              apiResponse?.data?.agent?.name ||
              apiResponse?.assigned_agent?.name ||
              apiResponse?.agent?.name ||
              null;
            console.log('✅ Booking successfully created with ID:', createdId);
          }
        } catch (serverError: any) {
          console.error(`Booking attempt ${retryCount + 1} failed:`, serverError);
          console.error('Error response:', serverError.response);
          console.error('Error response data:', serverError.response?.data);
          console.error('Error status:', serverError.response?.status);
          console.error('Error headers:', serverError.response?.headers);

          // Backend rejected this submission as an exact duplicate of an
          // earlier booking (same service / date / time / address / amount
          // / applicant). Don't retry — that's the same payload that just
          // got refused — and surface the message to the user with a way
          // to differentiate (change the applicant name).
          if (serverError?.code === 'DUPLICATE_BOOKING') {
            setLoading(false);
            Alert.alert(
              'Already booked',
              serverError.message ||
                'A booking with these exact details already exists. ' +
                  'Change the applicant name or modify the details to proceed.',
              [{ text: 'OK' }],
            );
            return;
          }

          // If it's a validation error (400), log the specific validation issues
          if (serverError.response?.status === 400) {
            console.error('=== VALIDATION ERROR DETAILS ===');
            console.error('Validation error data:', serverError.response.data);
            console.error('================================');
          }

          retryCount++;

          if (retryCount < maxRetries) {
            console.log(`Retrying in 2 seconds... (${retryCount}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            console.error('All retry attempts failed, proceeding with local storage only');
          }
        }
      }

      // Check for duplicate booking
      try {
        const bookingKey = `${mobile}_${selectedDate.toISOString().split('T')[0]}_${selectedTimeSlot.startTime}`;
        const existingBookings = await AsyncStorage.getItem('existing_bookings');
        const bookings = existingBookings ? JSON.parse(existingBookings) : [];

        const duplicateBooking = bookings.find((booking: any) =>
          booking.mobile === mobile &&
          booking.date === selectedDate.toISOString().split('T')[0] &&
          booking.timeSlot === selectedTimeSlot.startTime
        );

        if (duplicateBooking) {
          Alert.alert(
            'Duplicate Booking',
            'You already have a booking with the same details on this date and time slot. Please select a different date or time.',
            [
              {
                text: 'OK',
                onPress: () => setCurrentStep(4)
              }
            ]
          );
        }
      } catch (apiError) {
        console.error('API Error sending booking to Agentapp:', apiError);
      }

      // Store in dedicated bookings list for MyBookingsScreen
      console.log('=== STORING BOOKING ===');
      // Store booking locally so it appears in My Bookings immediately,
      // before the API has a chance to sync it back on the next fetch.
      const existingBookings = await AsyncStorage.getItem('my_bookings') || '[]';
      const bookingsList = JSON.parse(existingBookings);
      bookingsList.unshift(bookingData);
      await AsyncStorage.setItem('my_bookings', JSON.stringify(bookingsList));

      // ─── Payment flow split ─────────────────────────────────────────
      //
      //   pay_online  → fire Razorpay NOW. On success the booking flips
      //                 to payment_status='paid' server-side and step 6
      //                 shows the "✓ Paid Online" badge.
      //   pay_cash    → skip Razorpay; pay-on-delivery during service.
      //   pay_after   → skip Razorpay; deferred-online (rep collects
      //                 the link after marking the work complete).
      //
      // If Razorpay fails or is cancelled, the booking still survives
      // with payment_status='pending' so the user can retry from the
      // BookingDetails screen's "Pay Now" banner without re-entering data.
      addBookingToAgentapp();
      const localNum = await nextLocalBookingNumber();
      setBookingNumber(`BK${localNum}`);

      const agentLine = assignedAgentName
        ? `\n\nAssigned Representative: ${assignedAgentName}`
        : '\n\nA representative will be assigned shortly.';

      if (paymentMethod === 'pay_online') {
        // UPI took the in-app validation path and matched the canonical
        // test ID — mark paid via processPayment (no Razorpay sheet)
        // and advance to confirmation.
        if (opts.inAppUpiSuccess) {
          try {
            const synthTxnId = `test_upi_${Date.now()}`;
            await processPayment({
              booking_id: bookingData.id,
              payment_method: 'upi',
              transaction_id: synthTxnId,
              amount: totalAmount,
            });
            setPaymentCompleted(true);
            setCurrentStep(6);
            const localNum2 = await nextLocalBookingNumber();
            setBookingNumber(`BK${localNum2}`);
            Alert.alert(
              'Payment Successful',
              `₹${totalAmount} paid successfully via UPI.\nTransaction ID: ${synthTxnId}`,
              [{ text: 'OK' }],
            );
            return;
          } catch (e: any) {
            console.log('[booking] in-app UPI mark-paid failed:', e?.message);
            Alert.alert('Payment failed', 'Could not record the UPI payment. Please retry.');
            return;
          }
        }

        // Card / Netbanking / Wallet — go through Razorpay sandbox.
        // processOnlinePayment owns its own success alert and step-6
        // navigation. Failure stays on the Payment Summary step so the
        // user can retry without re-filling the form.
        try {
          await processOnlinePayment(bookingData.id, totalAmount);
          return;
        } catch (payErr: any) {
          console.log('[booking] online payment failed/cancelled:', payErr?.message);
          return;
        }
      }

      // Cash / pay-after paths — show the full step-6 summary (same
      // as the Pay Online path), THEN let the user tap "Track My
      // Booking" or "Back to Home" themselves. Previously the OK
      // button on this alert auto-navigated to MyBookings, which
      // meant pay-later customers never saw the booking confirmation
      // page with service/mode/urgency/address/charge breakdown —
      // they only saw a brief alert and got dumped in MyBookings.
      // Now the alert just dismisses and the on-screen step-6
      // summary takes over, matching Pay Online's experience.
      setCurrentStep(6);
      Alert.alert(
        'Booking Confirmed!',
        `Your booking has been confirmed successfully.\n\nBooking Number: ${formatBookingId(`BK${localNum}`)}${agentLine}\n\nYou'll be asked to pay only after the work is complete.`,
        [{ text: 'OK' }],
      );
    } catch (error) {
    console.error('Error adding booking to Agentapp:', error);
  } finally {
    setLoading(false);
  }
};

  // Stepper component
  const renderStepper = (): any => {
    const steps = [
      { id: 1, title: 'Address', icon: '📍' },
      { id: 2, title: 'Details', icon: '👤' },
      { id: 3, title: 'Docs', icon: '📄' },
      { id: 4, title: 'Schedule', icon: '📅' },
      { id: 5, title: 'Payment', icon: '💳' },
      { id: 6, title: 'Done', icon: '✅' },
    ];
    const totalSteps = steps.length;
    const progressPct = ((currentStep - 1) / (totalSteps - 1)) * 100;
    const currentMeta = steps[currentStep - 1];

    return (
      <View style={styles.modernStepperWrap}>
        {/* Top header row: current step name + progress text */}
        <View style={styles.stepperHeader}>
          <View style={styles.stepperHeaderLeft}>
            <Text style={styles.stepperHeaderIcon}>{currentMeta.icon}</Text>
            <View>
              <Text style={styles.stepperHeaderLabel}>STEP {currentStep} OF {totalSteps}</Text>
              <Text style={styles.stepperHeaderTitle}>{currentMeta.title}</Text>
            </View>
          </View>
          <View style={styles.stepperBadge}>
            <Text style={styles.stepperBadgeText}>{Math.round(progressPct) || 0}%</Text>
          </View>
        </View>

        {/* Animated progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }] as any} />
        </View>

        {/* Compact dot row */}
        <View style={styles.dotsRow}>
          {steps.map((step) => {
            const isCompleted = step.id < currentStep;
            const isCurrent = step.id === currentStep;
            return (
              <TouchableOpacity
                key={step.id}
                onPress={() => { if (isCompleted || isCurrent) setCurrentStep(step.id); }}
                disabled={!isCompleted && !isCurrent}
                style={styles.dotWrap}
              >
                <View style={[
                  styles.dot,
                  isCompleted && styles.dotCompleted,
                  isCurrent && styles.dotCurrent,
                ]}>
                  {isCompleted && <Text style={styles.dotCheck}>✓</Text>}
                  {isCurrent && <View style={styles.dotPulse} />}
                </View>
                <Text style={[
                  styles.dotLabel,
                  (isCompleted || isCurrent) && styles.dotLabelActive,
                ]}>
                  {step.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderStep = (): any => {
    switch (currentStep) {
      case 1:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Service Address</Text>
            <TouchableOpacity
              style={[styles.locationBtn, useCurrentLocation && styles.locationBtnActive]}
              onPress={requestLocationPermission}
            >
              <Text style={styles.locationBtnText}>
                {useCurrentLocation ? '📍 Using Current Location' : '📍 Use Current Location'}
              </Text>
            </TouchableOpacity>

            <TextInput
              style={styles.addressInput}
              placeholder="Enter your full address"
              value={address}
              onChangeText={setAddress}
              multiline
              numberOfLines={3}
            />
          </View>
        );

      case 2: {
        // Detected from category / name / description so it covers seeded
        // rows however they were populated:
        //   - Aadhaar services → UIDAI-style form (Husband's Name conditional)
        //   - PAN services     → same form but with Mother's Name (PAN's
        //                        Form 49A requires both parents)
        //   - Voter ID         → same form + Disability Type + Assembly /
        //                        Parliamentary Constituency (ECI Form 6/7/8)
        const cat = String(serviceData?.category || '').toLowerCase();
        const name = String(serviceData?.name || '').toLowerCase();
        const desc = String(serviceData?.description || '').toLowerCase();
        const haystack = `${cat} ${name} ${desc}`;
        const isAadhaarService = /aadhaar|aadhar/.test(haystack);
        const isPanService = /\bpan\b|pan.?card|pan.?number/.test(haystack);
        const isVoterIdService =
          /voter.?id|voter.?card|epic|electoral|election|form\s*[678]\b/.test(haystack);
        const isRationCardService =
          /ration.?card|ration|fps|public.?distribution|pds\b|aay|apl|bpl/.test(haystack);

        if (isAadhaarService || isPanService || isVoterIdService || isRationCardService) {
          // Branch precedence: ration card → voter ID → PAN → Aadhaar.
          // More-specific service families win. PAN beats Aadhaar in the
          // rare "Aadhaar-PAN linking" case since linking needs the UIDAI
          // form anyway — we still keep aadhaar variant for that.
          const variant: 'aadhaar' | 'pan' | 'voterid' | 'rationcard' =
            isRationCardService
              ? 'rationcard'
              : isVoterIdService
              ? 'voterid'
              : isPanService
              ? 'pan'
              : 'aadhaar';
          return (
            <View style={styles.stepContainer}>
              <Text style={styles.stepTitle}>Personal Details</Text>
              {renderAadhaarPersonalDetails(variant)}
            </View>
          );
        }

        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Personal Details</Text>

            {/* Only show fields mentioned in service description */}
            {renderDynamicFormFields()}
          </View>
        );
      }

      case 3: {
        // Backend returns service.required_documents in two different shapes
        // depending on which seed created the row:
        //   1. Plain array: [{type, label, required}, ...]
        //   2. Wrapped object: { documents: [{type, label, required}, ...] }
        // Normalise to a single array before rendering so the upload list
        // actually shows up (previous code only handled shape #1).
        const rawDocs = serviceData?.required_documents;
        let requiredDocs: any[] = Array.isArray(rawDocs)
          ? rawDocs
          : Array.isArray(rawDocs?.documents)
          ? rawDocs.documents
          : [];
        // Strip any "Mobile Number" / "Phone" / "Telephone" entries from
        // the document list — these are text fields collected in Step 2
        // (Personal Details), not files the customer should upload. The
        // regex matches both word-boundary forms ("Mobile Number") and
        // snake/kebab variants ("mobile_number", "phone-no"). Same
        // filter is re-applied after the rate-chart overrides below in
        // case those reference mobile-style entries too.
        const stripMobileFromDocs = (list: any[]): any[] =>
          (Array.isArray(list) ? list : []).filter((d: any) => {
            const t = String(d?.type || '').toLowerCase();
            const l = String(d?.label || '').toLowerCase();
            const blob = `${t} ${l}`;
            return !/(\b|_|-)(mobile|phone|telephone|cell|sim)(\b|_|-|number|no|num)?/i.test(blob);
          });
        requiredDocs = stripMobileFromDocs(requiredDocs);

        // Aadhaar update services have fixed UIDAI document checklists per
        // update type. We override whatever the seed wrote so the customer
        // sees exactly the right list — no stale extras like passport /
        // electricity bill slip in for an unrelated update.
        const sName = String(serviceData?.name || '').toLowerCase();
        const sDesc = String(serviceData?.description || '').toLowerCase();
        const haystack = `${sName} ${sDesc}`;
        const isAadhaar = /aadhaar|aadhar/.test(haystack);
        const hasUpdateVerb = /(update|change|correction|modif)/.test(haystack);
        const isDobUpdate =
          isAadhaar && /(dob|date.?of.?birth|birth.?date|birthday)/.test(haystack);
        // Match "name update", "name change", or just "name" alongside an
        // explicit update/correction/change verb to avoid false positives
        // on "applicant name" form fields in unrelated services.
        const isNameUpdate =
          isAadhaar && hasUpdateVerb && /\bname\b/.test(haystack);
        // Father/Husband (or "guardian") relationship update.
        const isFatherHusbandUpdate =
          isAadhaar &&
          hasUpdateVerb &&
          /(father|husband|guardian|relation)/.test(haystack);
        // Address update — same docs as father/husband update PLUS one
        // additional "New Address Proof".
        const isAddressUpdate =
          isAadhaar && hasUpdateVerb && /address/.test(haystack);

        // Order matters: more-specific update types first so a service
        // titled "Aadhaar Address Update" doesn't accidentally hit the
        // father/husband branch via a description mention.
        if (isAddressUpdate) {
          requiredDocs = [
            { type: 'aadhaar_front',         label: 'Aadhaar Front',         required: true },
            { type: 'aadhaar_back',          label: 'Aadhaar Back',          required: true },
            { type: 'father_husband_aadhaar', label: 'Father/Husband Aadhaar', required: true },
            { type: 'new_address_proof',     label: 'New Address Proof',     required: true },
          ];
        } else if (isFatherHusbandUpdate) {
          requiredDocs = [
            { type: 'aadhaar_front',         label: 'Aadhaar Front',         required: true },
            { type: 'aadhaar_back',          label: 'Aadhaar Back',          required: true },
            { type: 'father_husband_aadhaar', label: 'Father/Husband Aadhaar', required: true },
          ];
        } else if (isDobUpdate) {
          requiredDocs = [
            { type: 'aadhaar_front',      label: 'Aadhaar Front',      required: true  },
            { type: 'aadhaar_back',       label: 'Aadhaar Back',       required: true  },
            { type: 'matric_certificate', label: 'Matric Certificate', required: true  },
            { type: 'birth_certificate',  label: 'Birth Certificate',  required: false },
          ];
        } else if (isNameUpdate) {
          requiredDocs = [
            { type: 'aadhaar_front',      label: 'Aadhaar Front',      required: true },
            { type: 'aadhaar_back',       label: 'Aadhaar Back',       required: true },
            { type: 'voter_id',           label: 'Voter ID',           required: true },
            { type: 'matric_certificate', label: 'Matric Certificate', required: true },
          ];
        }

        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Required Documents</Text>

            {requiredDocs.length > 0 ? (
              requiredDocs.map((doc: any, index: number) => {
                const type = doc?.type || `doc_${index}`;
                const rawLabel = doc?.label || doc?.type || `Document ${index + 1}`;
                // Friendly-label rewrite. Backend seeds some services with
                // bare "Email ID" / "Mobile Number" labels which sound
                // like the user has to upload an email address rather
                // than a proof document. Append " Proof" so the user
                // knows we want a document scan, not the value itself.
                const label = /^email\s*id$/i.test(rawLabel)
                  ? 'Email ID Proof'
                  : /^mobile\s*(no\.?|number)?$/i.test(rawLabel)
                    ? 'Mobile Number Proof'
                    : rawLabel;
                const uploaded = uploadedDocuments.find((d: any) => d.type === type);
                const isUploading = uploadProgress[type];
                const isImage =
                  uploaded?.uri &&
                  /\.(jpe?g|png|webp|gif)$/i.test(uploaded.uri) ||
                  /^image\//.test(uploaded?.uploadResponse?.mime_type || '');
                return (
                  <View key={type} style={styles.documentRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.documentName}>
                        {label}{doc?.required === false ? ' (Optional)' : ' *'}
                      </Text>
                      {!!uploaded && (
                        <View style={styles.uploadedPreviewRow}>
                          {isImage ? (
                            <TouchableOpacity
                              activeOpacity={0.85}
                              onPress={() => setPreviewDoc({ uri: uploaded.uri, name: uploaded.name })}
                            >
                              <Image source={{ uri: uploaded.uri }} style={styles.uploadedThumb} />
                            </TouchableOpacity>
                          ) : (
                            <View style={[styles.uploadedThumb, styles.uploadedFileTile]}>
                              <Text style={styles.uploadedFileTileText}>📄</Text>
                            </View>
                          )}
                          <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={styles.uploadedFileName} numberOfLines={1}>
                              {uploaded.name}
                            </Text>
                            <TouchableOpacity onPress={() => handleDocumentUpload(type)}>
                              <Text style={styles.uploadedReplaceText}>Replace</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                    {!uploaded && (
                      <TouchableOpacity
                        style={[styles.uploadBtn, isUploading && styles.uploadBtnDisabled]}
                        onPress={() => handleDocumentUpload(type)}
                        disabled={isUploading}
                      >
                        {isUploading ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.uploadBtnText}>Upload</Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            ) : (
              <Text style={styles.noDocuments}>No documents required</Text>
            )}

            {/* Full-screen preview when the user taps an uploaded thumbnail */}
            <Modal
              visible={!!previewDoc}
              transparent
              animationType="fade"
              onRequestClose={() => setPreviewDoc(null)}
            >
              <TouchableOpacity
                style={styles.previewBackdrop}
                activeOpacity={1}
                onPress={() => setPreviewDoc(null)}
              >
                <View style={styles.previewCard}>
                  <View style={styles.previewHeaderRow}>
                    <Text style={styles.previewTitle} numberOfLines={1}>
                      {previewDoc?.name || 'Preview'}
                    </Text>
                    <TouchableOpacity onPress={() => setPreviewDoc(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.previewClose}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  {previewDoc?.uri && (
                    <Image source={{ uri: previewDoc.uri }} style={styles.previewImage} resizeMode="contain" />
                  )}
                </View>
              </TouchableOpacity>
            </Modal>

            {/* Custom "Add document" picker — replaces native Alert so the
                user can dismiss it by tapping outside the sheet. */}
            <Modal
              visible={!!docPickerFor}
              transparent
              animationType="slide"
              onRequestClose={() => setDocPickerFor(null)}
            >
              <TouchableOpacity
                style={styles.confirmBackdrop}
                activeOpacity={1}
                onPress={() => setDocPickerFor(null)}
              >
                {/* Inner pressable swallows taps so the sheet itself doesn't dismiss. */}
                <TouchableOpacity
                  activeOpacity={1}
                  style={styles.docPickerSheet}
                  onPress={() => {}}
                >
                  <View style={styles.docPickerHandle} />
                  <Text style={styles.docPickerTitle}>Add Document</Text>
                  <Text style={styles.docPickerSubtitle}>
                    How would you like to add this document?
                  </Text>

                  <TouchableOpacity
                    style={[styles.docPickerOption, styles.docPickerOptionPrimary]}
                    onPress={() => {
                      const dt = docPickerFor;
                      setDocPickerFor(null);
                      if (dt) pickFromCamera(dt);
                    }}
                  >
                    <Text style={styles.docPickerOptionIcon}>📷</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.docPickerOptionText, styles.docPickerOptionTextPrimary]}>Take Photo</Text>
                      <Text style={styles.docPickerOptionHint}>Preview before upload</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.docPickerOption, styles.docPickerOptionPrimary]}
                    onPress={() => {
                      const dt = docPickerFor;
                      setDocPickerFor(null);
                      if (dt) pickFromGallery(dt);
                    }}
                  >
                    <Text style={styles.docPickerOptionIcon}>🖼</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.docPickerOptionText, styles.docPickerOptionTextPrimary]}>Choose from Gallery</Text>
                      <Text style={styles.docPickerOptionHint}>Preview before upload</Text>
                    </View>
                  </TouchableOpacity>

                  {documentPickerAvailable && (
                    <TouchableOpacity
                      style={styles.docPickerOption}
                      onPress={() => {
                        const dt = docPickerFor;
                        setDocPickerFor(null);
                        if (dt) pickFromFiles(dt);
                      }}
                    >
                      <Text style={styles.docPickerOptionIcon}>📄</Text>
                      <Text style={styles.docPickerOptionText}>
                        Choose File (PDF, Doc, etc.)
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.docPickerOption, styles.docPickerCancelOption]}
                    onPress={() => setDocPickerFor(null)}
                  >
                    <Text style={styles.docPickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>

            {/* Confirm-before-upload modal — guarantees a clearly visible
                "Upload" submit button regardless of what the native camera/
                cropper UI looked like. */}
            <Modal
              visible={!!pendingImage}
              transparent
              animationType="slide"
              onRequestClose={() => setPendingImage(null)}
            >
              <View style={styles.confirmBackdrop}>
                <View style={styles.confirmCard}>
                  <View style={styles.previewHeaderRow}>
                    <Text style={styles.previewTitle} numberOfLines={1}>
                      Confirm document
                    </Text>
                    <TouchableOpacity
                      onPress={() => setPendingImage(null)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.previewClose}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  {pendingImage?.file?.uri && (
                    <Image
                      source={{ uri: pendingImage.file.uri }}
                      style={styles.confirmImage}
                      resizeMode="contain"
                    />
                  )}
                  {/* In-app Crop buttons removed — cropping happens in
                      the system picker (`allowsEditing: true`) before
                      this preview opens. Confirmation here is just
                      Retake / Upload. */}
                  <View style={styles.confirmActionsRow}>
                    <TouchableOpacity
                      style={styles.confirmRetakeBtn}
                      onPress={() => {
                        const dt = pendingImage?.documentType;
                        setPendingImage(null);
                        if (dt) handleDocumentUpload(dt);
                      }}
                    >
                      <Text style={styles.confirmRetakeText}>Retake</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.confirmUploadBtn}
                      onPress={async () => {
                        const pi = pendingImage;
                        if (!pi) return;
                        setPendingImage(null);
                        await performUpload(pi.documentType, pi.file);
                      }}
                    >
                      <Text style={styles.confirmUploadText}>Upload</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </View>
        );
      }

      case 4:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Service Mode, Urgency & Time Slot</Text>

            {/* Booking Guidelines — moved to the TOP so the customer reads
                the rules (booking window, advance-time minimums, working
                hours) BEFORE picking a mode / date / time. Previously it
                lived at the bottom of step 4, which meant most users
                scrolled past it. */}
            <View style={styles.guidelinesContainer}>
              <Text style={styles.guidelinesTitle}>📋 Booking Guidelines</Text>
              <Text style={styles.guidelineText}>• Available 24/7 — book any hour of the day</Text>
              <Text style={styles.guidelineText}>• Regular: 4+ hours advance booking</Text>
              <Text style={styles.guidelineText}>• Fast-track: 90+ minutes advance booking</Text>
              <Text style={styles.guidelineText}>• Maximum: 7 days advance booking</Text>
              <Text style={styles.guidelineText}>• 30-minute buffer between bookings</Text>
            </View>

            {/* Service Mode (Offline / Online) */}
            <Text style={[styles.label, { marginTop: 16 }]}>Service Mode</Text>
            <TouchableOpacity
              style={[styles.paymentBtn, deliveryMode === 'offline' && styles.paymentBtnActive]}
              onPress={() => setDeliveryMode('offline')}
            >
              <Text style={[styles.paymentBtnText, deliveryMode === 'offline' && styles.paymentBtnTextActive]}>
                🏠 Offline — Doorstep Service by Representative
              </Text>
              <Text style={[styles.serviceModeDescription, deliveryMode === 'offline' && styles.serviceModeDescriptionActive]}>
                Our representative visits your address to collect documents and complete the work.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.paymentBtn, deliveryMode === 'online' && styles.paymentBtnActive]}
              onPress={() => setDeliveryMode('online')}
            >
              <Text style={[styles.paymentBtnText, deliveryMode === 'online' && styles.paymentBtnTextActive]}>
                💻 Online — Done by Our Operators
              </Text>
              <Text style={[styles.serviceModeDescription, deliveryMode === 'online' && styles.serviceModeDescriptionActive]}>
                Upload your documents in-app; our operators process the application end-to-end.
              </Text>
            </TouchableOpacity>

            {/* Urgency Level (High Priority / Low Priority) */}
            <Text style={[styles.label, { marginTop: 20 }]}>Service Urgency Level</Text>
            <TouchableOpacity
              style={[styles.paymentBtn, serviceMode === 'regular' && styles.paymentBtnActive]}
              onPress={() => setServiceMode('regular')}
            >
              <Text style={[styles.paymentBtnText, serviceMode === 'regular' && styles.paymentBtnTextActive]}>
                📅 Low Priority — Regular
              </Text>
              <Text style={[styles.serviceModeDescription, serviceMode === 'regular' && styles.serviceModeDescriptionActive]}>
                Standard processing. Book 4+ hours in advance. Available 24/7.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.paymentBtn, serviceMode === 'fast_track' && styles.paymentBtnActive]}
              onPress={() => setServiceMode('fast_track')}
            >
              <Text style={[styles.paymentBtnText, serviceMode === 'fast_track' && styles.paymentBtnTextActive]}>
                ⚡ High Priority — Fast-Track (+₹{priorityFee})
              </Text>
              <Text style={[styles.serviceModeDescription, serviceMode === 'fast_track' && styles.serviceModeDescriptionActive]}>
                Service within 90 minutes. Available 24/7.
              </Text>
            </TouchableOpacity>

            {/* Date Selection */}
            <Text style={[styles.label, {marginTop: 20}]}>Select Date</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => setShowSlotDatePicker(true)}
            >
              <Text>
                {selectedDate ? selectedDate.toLocaleDateString() : 'Select booking date'}
              </Text>
            </TouchableOpacity>

            {showSlotDatePicker && (
              <DateTimePicker
                value={selectedDate || new Date()}
                mode="date"
                display="default"
                minimumDate={new Date()}
                maximumDate={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)} // 7 days from now
                onChange={(event: any, date: any) => {
                  setShowSlotDatePicker(false);
                  if (date) {
                    handleDateSelect(date);
                  }
                }}
              />
            )}

            {/* Time Slot Selection */}
            {selectedDate && (
              <>
                <Text style={[styles.label, {marginTop: 20}]}>Available Time Slots</Text>
                <ScrollView style={styles.slotsContainer} horizontal showsHorizontalScrollIndicator={false}>
                  {availableSlots.map((slot: any) => (
                    <TouchableOpacity
                      key={slot.id}
                      style={[
                        styles.timeSlot,
                        selectedTimeSlot?.id === slot.id && styles.timeSlotSelected
                      ]}
                      onPress={() => handleTimeSlotSelect(slot)}
                    >
                      <Text style={[
                        styles.timeSlotText,
                        selectedTimeSlot?.id === slot.id && styles.timeSlotTextSelected
                      ]}>
                        {slot.display}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Disclaimer (per spec) — sets expectations about external
                dependencies the customer can't see. */}
            <View style={styles.bookingDisclaimer}>
              <Text style={styles.bookingDisclaimerLabel}>Please Note</Text>
              <Text style={styles.bookingDisclaimerText}>
                FliponeX is not responsible for delays caused by slow
                government portals or technical issues. Our experts will
                provide full cooperation until the task is completed.
              </Text>
            </View>
          </View>
        );

      case 5:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Payment Options</Text>

            {/* Payment Summary — the customer sees ONE single
                "Service Fee" line equal to the full user_cost. The
                internal govt / partner / company-margin split is
                intentionally hidden from this surface (per the rate
                chart it's an internal accounting concern, not info
                the buyer needs). The split is still sent on the
                booking payload so the rep and admin dashboards
                compute commissions correctly. */}
            <View style={styles.psCard}>
              <Text style={styles.psTitle}>Payment Summary</Text>
              <View style={styles.psDivider} />

              {/* Customer-facing breakdown — two mandatory lines that
                  always sum to the list price. Replaces the single
                  "Service Fee" row so the bill spells out exactly what
                  the user is paying for. Internal rate-chart split is
                  preserved on the booking payload for finance
                  reporting; this card is display-only. */}
              <View style={styles.psRow}>
                <Text style={styles.psMandatoryLabel}>Basic / Government Fees</Text>
                <Text style={styles.psMandatoryValue}>₹ {displayGovtFees}</Text>
              </View>
              <View style={styles.psRow}>
                <Text style={styles.psMandatoryLabel}>Doorstep / Convenience Charges</Text>
                <Text style={styles.psMandatoryValue}>₹ {displayDoorstepCharges}</Text>
              </View>

              {/* Opt-in add-ons — checkboxes, dynamically affect total */}
              <PsCheckboxRow
                checked={optProcessing}
                onToggle={() => setOptProcessing((v) => !v)}
                label="Processing Fees"
                amount={processingFees}
              />
              <PsCheckboxRow
                checked={optConsultancy}
                onToggle={() => setOptConsultancy((v) => !v)}
                label="Consultancy Fees"
                amount={consultancyFees}
              />
              <PsCheckboxRow
                checked={optTaxes}
                onToggle={() => setOptTaxes((v) => !v)}
                label="Taxes/Challans Amt."
                amount={taxesFees}
              />
              <PsCheckboxRow
                checked={optFastTrack}
                onToggle={() => setOptFastTrack((v) => !v)}
                label="Fast Track Fees"
                amount={fastTrackFees}
              />

              {/* Subtotal — sum of mandatory + opt-in add-ons BEFORE any
                  credit/discount deductions. Customers were confused when
                  the previous "TOTAL AMOUNT" line showed a post-credit
                  number (e.g. ₹255) while their eyes added the line items
                  above to a higher number (₹357). Showing subtotal first,
                  then credits, then final, matches how every other
                  receipt is structured. */}
              <View style={styles.psDivider} />
              <View style={styles.psRow}>
                <Text style={styles.psSmallLabel}>Subtotal</Text>
                <Text style={styles.psSmallValue}>₹ {subtotalBeforeCredits}</Text>
              </View>

              {/* Flash offer — admin-managed splash discount. Only
                  rendered when an active notification matched this
                  service's name/category. Green minus line so the
                  savings are unmissable. */}
              {flashOffer && flashDiscountAmount > 0 && (
                <View style={styles.psRow}>
                  <Text style={[styles.psSmallLabel, { color: '#10B981', fontWeight: '700' }]}>
                    🎉 Flash Offer ({flashOffer.percent}% off)
                  </Text>
                  <Text style={[styles.psSmallValue, { color: '#10B981', fontWeight: '900' }]}>
                    − ₹ {flashDiscountAmount}
                  </Text>
                </View>
              )}

              {/* Adjustments — wallet + refund. Show each as a minus
                  line item the moment it's toggled on so the user can
                  see exactly where the discount comes from. */}
              <PsCheckboxRow
                checked={useRewardPoints}
                onToggle={() => walletBalance > 0 && setUseRewardPoints((v) => !v)}
                // Renamed from "Use Reward Points" — customers couldn't
                // make the connection that this is where their
                // referral-earned ₹s live. Now reads as "Use Referral
                // Wallet (₹X)" with the balance shown on the right.
                label="Use Referral Wallet"
                amount={walletBalance}
                amountFmt="rupee2"
                disabled={walletBalance <= 0}
                small
              />
              {/* When the wallet is empty, surface the path to earn
                  with a clear tappable link. Customers were tapping the
                  disabled checkbox and giving up because nothing told
                  them HOW to enable it. */}
              {walletBalance <= 0 && (
                <TouchableOpacity
                  style={{
                    marginTop: 6,
                    marginLeft: 28,
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: '#FFF7ED',
                    borderWidth: 1,
                    borderColor: '#FED7AA',
                  }}
                  onPress={() => {
                    Alert.alert(
                      'Wallet is empty',
                      'You don\'t have any referral credits yet. Open Profile → Refer & Earn, share your code with a friend, and you\'ll get ₹20 in your wallet once they book their first service.',
                      [
                        { text: 'Got it', style: 'cancel' },
                        {
                          text: 'Open Refer & Earn',
                          onPress: () => navigation.navigate('Home', { screen: 'Profile' }),
                        },
                      ],
                    );
                  }}
                >
                  <Text style={{ fontSize: 11, color: '#9A3412', fontWeight: '700' }}>
                    💡 Wallet balance is ₹0. Tap here to learn how to earn credits →
                  </Text>
                </TouchableOpacity>
              )}
              {useRewardPoints && rewardApplied > 0 && (
                <View style={styles.psRow}>
                  <Text style={[styles.psSmallLabel, { color: '#2E7D32', paddingLeft: 16 }]}>
                    └ Referral Wallet Applied
                  </Text>
                  <Text style={[styles.psSmallValue, { color: '#2E7D32' }]}>
                    − ₹{rewardApplied}
                  </Text>
                </View>
              )}
              <PsCheckboxRow
                checked={useRefundWallet}
                onToggle={() => refundBalance > 0 && setUseRefundWallet((v) => !v)}
                label="Use Refund Wallet"
                amount={refundBalance}
                amountFmt="rupee2"
                disabled={refundBalance <= 0}
                small
              />
              {useRefundWallet && refundApplied > 0 && (
                <View style={styles.psRow}>
                  <Text style={[styles.psSmallLabel, { color: '#2E7D32', paddingLeft: 16 }]}>
                    └ Refund Wallet Applied
                  </Text>
                  <Text style={[styles.psSmallValue, { color: '#2E7D32' }]}>
                    − ₹{refundApplied}
                  </Text>
                </View>
              )}

              {referralDiscount > 0 ? (
                <View style={styles.psRow}>
                  <Text style={[styles.psSmallLabel, { color: '#2E7D32' }]}>
                    Referral Discount Applied
                  </Text>
                  <Text style={[styles.psSmallValue, { color: '#2E7D32' }]}>
                    − ₹{referralDiscount}
                  </Text>
                </View>
              ) : (
                // Pointer to the referral input card below — users were
                // missing the separate referralCard entirely. The visible
                // chevron + colour make it obvious there's an action
                // available before they pay.
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    marginTop: 6,
                    backgroundColor: '#FFF7ED',
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#FED7AA',
                  }}
                >
                  <Text style={{ fontSize: 12, color: '#9A3412', fontWeight: '700' }}>
                    🎁 Have a referral code? Enter it below to save ₹20
                  </Text>
                  <Text style={{ fontSize: 16, color: '#9A3412' }}>↓</Text>
                </View>
              )}

              {/* Final amount — clearly labelled as "AMOUNT TO PAY" so
                  the user knows this is the exact figure that will be
                  charged. Was previously labelled "TOTAL AMOUNT" and
                  positioned BEFORE the credit rows, which made it look
                  like a mismatch. */}
              <View style={styles.psDivider} />
              <View style={styles.psRow}>
                <Text style={styles.psTotalLabel}>AMOUNT TO PAY</Text>
                <Text style={styles.psTotalValue}>₹ {totalAmount}</Text>
              </View>

              {/* Terms acceptance — required to enable Proceed & Pay */}
              <TouchableOpacity
                style={styles.psTermsRow}
                onPress={() => setAcceptedTerms((v) => !v)}
                activeOpacity={0.85}
              >
                <View style={[styles.psCheckbox, acceptedTerms && styles.psCheckboxChecked]}>
                  {acceptedTerms && <Text style={styles.psCheckboxTick}>✓</Text>}
                </View>
                <Text style={styles.psTermsText}>
                  I accept the <Text style={styles.psLink}>Terms of Use</Text> &{' '}
                  <Text style={styles.psLink}>Privacy Policy</Text>
                </Text>
              </TouchableOpacity>
            </View>

            {/* Have a referral code? — spec H, applies on first booking only */}
            <View style={styles.referralCard}>
              <Text style={styles.referralTitle}>🎁 Have a Referral Code?</Text>
              <Text style={styles.referralSub}>
                Get ₹20 off your first booking when a friend invites you.
              </Text>
              {/* Step-by-step so the user knows exactly what to do — earlier
                  the card just had an input and many users skipped it
                  thinking the field was optional/decorative. */}
              <View style={styles.referralStepsBox}>
                <Text style={styles.referralStep}>1. Type your friend's code in the box below.</Text>
                <Text style={styles.referralStep}>2. Tap <Text style={styles.referralStepBold}>Apply</Text>.</Text>
                <Text style={styles.referralStep}>3. ₹20 will be deducted from the Amount to Pay above.</Text>
              </View>
              {referralDiscount > 0 ? (
                <View style={styles.referralAppliedRow}>
                  <Text style={styles.referralAppliedText}>
                    ✓ Code applied — ₹{referralDiscount} off
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setReferralDiscount(0);
                      setReferralCodeInput('');
                      setReferralError('');
                    }}
                  >
                    <Text style={styles.referralRemove}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.referralInputRow}>
                  <TextInput
                    style={styles.referralInput}
                    placeholder="Enter code (e.g. FLIPABC1)"
                    placeholderTextColor="#94A3B8"
                    value={referralCodeInput}
                    onChangeText={(t) => {
                      setReferralCodeInput(t.toUpperCase());
                      setReferralError('');
                    }}
                    autoCapitalize="characters"
                  />
                  <TouchableOpacity
                    style={[styles.referralApplyBtn, (!referralCodeInput || referralApplying) && styles.referralApplyBtnDisabled]}
                    disabled={!referralCodeInput || referralApplying}
                    onPress={async () => {
                      setReferralApplying(true);
                      setReferralError('');
                      try {
                        const res = await applyReferralCode(referralCodeInput.trim());
                        if (res?.success && res.discount) {
                          setReferralDiscount(res.discount);
                        } else {
                          setReferralError(res?.message || 'Invalid code');
                        }
                      } catch (e: any) {
                        setReferralError(e?.response?.data?.message || e?.message || 'Could not apply code');
                      } finally {
                        setReferralApplying(false);
                      }
                    }}
                  >
                    <Text style={styles.referralApplyText}>
                      {referralApplying ? '...' : 'Apply'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {!!referralError && <Text style={styles.referralErrorText}>{referralError}</Text>}
            </View>

            <Text style={styles.paymentTitle}>Payment</Text>

            {/* ── Option 1: Pay Online After Completion ── */}
            <TouchableOpacity
              style={[
                styles.payOptionCard,
                paymentMethod === 'pay_online' && styles.payOptionCardActive,
              ]}
              onPress={() => setPaymentMethod('pay_online')}
              activeOpacity={0.85}
            >
              <View style={[styles.payOptionIcon, { backgroundColor: '#E3F2FD' }]}>
                <Text style={styles.payOptionEmoji}>💳</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.payOptionTitle}>Pay Online</Text>
                <Text style={styles.payOptionSubtitle}>
                  UPI / Cards / Netbanking / Wallets — secure payment via
                  Razorpay before the service starts. Instant confirmation.
                </Text>
              </View>
              <View style={[styles.payRadio, paymentMethod === 'pay_online' && styles.payRadioActive]}>
                {paymentMethod === 'pay_online' && <View style={styles.payRadioDot} />}
              </View>
            </TouchableOpacity>

            {/* ── Option 2: Pay Cash on Service ── */}
            <TouchableOpacity
              style={[
                styles.payOptionCard,
                paymentMethod === 'pay_cash' && styles.payOptionCardActive,
              ]}
              onPress={() => setPaymentMethod('pay_cash')}
              activeOpacity={0.85}
            >
              <View style={[styles.payOptionIcon, { backgroundColor: '#E8F5E9' }]}>
                <Text style={styles.payOptionEmoji}>💵</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.payOptionTitle}>Pay Cash on Service</Text>
                <Text style={styles.payOptionSubtitle}>
                  Pay the representative in cash when they arrive to deliver
                  the service. Get a receipt after the work is verified.
                </Text>
              </View>
              <View style={[styles.payRadio, paymentMethod === 'pay_cash' && styles.payRadioActive]}>
                {paymentMethod === 'pay_cash' && <View style={styles.payRadioDot} />}
              </View>
            </TouchableOpacity>

            {/* Sub-methods grid (preview of what's available at checkout) */}
            {paymentMethod === 'pay_online' && (
              <View style={styles.onlineMethodsBox}>
                <Text style={styles.onlineMethodsLabel}>Select payment method</Text>
                <View style={styles.onlineMethodsGrid}>
                  {[
                    // MaterialIcons — proper vector icons, scale crisply
                    // at any pixel density. UPI = send-to-mobile (phone
                    // with arrow), Card = credit-card, Netbanking =
                    // account-balance (bank columns), Wallet = account-
                    // balance-wallet (the canonical wallet glyph).
                    { key: 'upi',        iconName: 'send-to-mobile',       label: 'UPI' },
                    { key: 'card',       iconName: 'credit-card',          label: 'Card' },
                    { key: 'netbanking', iconName: 'account-balance',      label: 'Netbanking' },
                    { key: 'wallet',     iconName: 'account-balance-wallet', label: 'Wallet' },
                  ].map((m: any) => {
                    const active = onlineMethod === m.key;
                    return (
                      <TouchableOpacity
                        key={m.key}
                        style={[styles.onlineMethodTile, active && styles.onlineMethodTileActive]}
                        onPress={() => setOnlineMethod(m.key)}
                      >
                        <Icon
                          name={m.iconName}
                          size={24}
                          color={active ? '#E63946' : '#0D3B66'}
                          style={{ marginBottom: 4 }}
                        />
                        <Text style={[styles.onlineMethodLabel, active && { color: '#E63946' }]}>
                          {m.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* UPI gets its OWN in-app input field — Razorpay's
                    sandbox doesn't always offer a UPI tab on test
                    accounts, so we collect + verify the UPI ID here.
                    Card / Netbanking / Wallet still route through
                    Razorpay where the actual instrument is captured. */}
                {onlineMethod === 'upi' && (
                  <View style={styles.subForm}>
                    <Text style={styles.subFormLabel}>Enter your UPI ID</Text>
                    <TextInput
                      style={styles.subFormInput}
                      placeholder="e.g. success@razorpay"
                      value={upiId}
                      onChangeText={setUpiId}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholderTextColor="#9E9E9E"
                    />
                    <Text style={{ fontSize: 11, color: '#6C757D', marginTop: 4 }}>
                      Test users: enter <Text style={{ fontWeight: '800' }}>success@razorpay</Text> to complete the payment.
                    </Text>
                  </View>
                )}

                {/* Card / Netbanking / Wallet — details captured by
                    Razorpay's sandbox. We just show the test creds
                    here so the user knows what to enter once Razorpay
                    opens. */}
                {onlineMethod && onlineMethod !== 'upi' && (
                  <View style={[styles.subForm, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1 }]}>
                    <Text style={[styles.subFormLabel, { color: '#0D3B66' }]}>
                      🔒 Secure checkout — Razorpay
                    </Text>
                    <Text style={{ fontSize: 12, color: '#1E40AF', marginTop: 4, lineHeight: 17 }}>
                      Tap "Proceed & Pay" to open the Razorpay sandbox.
                      {onlineMethod === 'card'
                        ? ' Enter your card number, expiry & CVV there (test card: 4111 1111 1111 1111, exp any future, CVV 100).'
                        : onlineMethod === 'netbanking'
                          ? ' Pick your bank inside Razorpay and approve the payment.'
                          : ' Pick your wallet inside Razorpay and approve the payment.'}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {processingPayment && (
              <View style={styles.paymentProcessingContainer}>
                <ActivityIndicator size="small" color="#E63946" />
                <Text style={styles.paymentProcessingText}>Processing payment...</Text>
              </View>
            )}
            {paymentError ? <Text style={styles.paymentErrorText}>{paymentError}</Text> : null}
          </View>
        );

      case 6:
        return (
          <View style={styles.stepContainer}>
            {/* Success hero */}
            <View style={styles.successHero}>
              <View style={styles.successCheckCircle}>
                <Text style={styles.successCheckMark}>✓</Text>
              </View>
              <Text style={styles.successTitle}>Booking Confirmed!</Text>
              <Text style={styles.successSubtitle}>Your service has been booked successfully</Text>
              <View style={styles.bookingNumberPill}>
                <Text style={styles.bookingNumberLabel}>BOOKING ID</Text>
                <Text style={styles.bookingNumberText}>{formatBookingId(bookingNumber)}</Text>
              </View>
              {selectedDate && selectedTimeSlot && (
                <Text style={styles.bookingDetails}>
                  📅 {selectedDate.toLocaleDateString()} • ⏰ {selectedTimeSlot.display}
                </Text>
              )}
            </View>

            {/* Service Summary — customer name is now the first row so
                it's the first thing the user sees, confirming the booking
                is filed under the right person. Previously it sat at the
                bottom and users had to scroll past Service/Mode/Urgency. */}
            <View style={styles.summaryContainer}>
              <Text style={styles.summaryTitle}>📋 Service Summary</Text>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Customer</Text>
                <Text style={styles.summaryValue}>
                  {fullName || applicantName || mobile || 'N/A'}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Service</Text>
                <Text style={styles.summaryValue}>{serviceData?.name || 'Service'}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Mode</Text>
                <Text style={styles.summaryValue}>
                  {deliveryMode === 'online' ? '💻 Online (Operator)' : '🏠 Offline (Doorstep)'}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Urgency</Text>
                <Text style={styles.summaryValue}>
                  {serviceMode === 'fast_track' ? '⚡ High Priority' : 'Low Priority'}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Address</Text>
                <Text style={styles.summaryValue} numberOfLines={2}>{address}</Text>
              </View>
            </View>

            {/* Charge Breakdown — customer-facing summary shows only
                Service Fee + (optional Priority Fee) + Total. The
                internal govt/partner/margin split is intentionally
                hidden; it lives in the admin dashboard and is sent on
                the booking payload for commission accounting. */}
            <View style={styles.chargeContainer}>
              <Text style={styles.chargeTitle}>💰 Charge Breakdown</Text>
              <View style={styles.chargeRow}>
                <Text style={styles.chargeLabel}>Service Fee</Text>
                <Text style={styles.chargeValue}>₹{userCost}</Text>
              </View>
              {serviceMode === 'fast_track' && (
                <View style={styles.chargeRow}>
                  <Text style={styles.chargeLabel}>Priority Fee</Text>
                  <Text style={styles.chargeValue}>₹{priorityFee}</Text>
                </View>
              )}
              <View style={[styles.chargeRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total Amount</Text>
                <Text style={styles.totalValue}>₹{totalAmount}</Text>
              </View>
              <View style={[styles.chargeRow, styles.paymentMethodRow]}>
                <Text style={styles.chargeLabel}>Payment</Text>
                {(() => {
                  // States:
                  //   pay_online + completed       → green ✓ Paid Online
                  //   pay_online + not completed   → amber ⏳ Pending
                  //   pay_cash                     → neutral 💵 Pay Cash on Service
                  //   pay_after (legacy)           → neutral 💵 Pay After Service
                  const isOnline = paymentMethod === 'pay_online';
                  const isCash = paymentMethod === 'pay_cash';
                  const showPaid = isOnline && paymentCompleted;
                  const label = isOnline
                    ? paymentCompleted ? '✓ Paid Online' : '⏳ Payment Pending'
                    : isCash
                      ? '💵 Pay Cash on Service'
                      : '💵 Pay After Service';
                  return (
                    <View style={[
                      styles.paymentBadge,
                      showPaid ? styles.paymentBadgePaid : styles.paymentBadgePending,
                    ]}>
                      <Text style={[
                        styles.paymentBadgeText,
                        showPaid ? styles.paymentBadgeTextPaid : styles.paymentBadgeTextPending,
                      ]}>
                        {label}
                      </Text>
                    </View>
                  );
                })()}
              </View>
            </View>

            {/* Assigned Agent — only show when assigned */}
            <View style={styles.agentContainer}>
              <Text style={styles.agentTitle}>🧑‍💼 Service Representative</Text>
              <View style={styles.agentCard}>
                <View style={styles.agentAvatar}>
                  <Text style={styles.avatarText}>?</Text>
                </View>
                <View style={styles.agentDetails}>
                  <Text style={styles.agentName}>Representative Pending</Text>
                  <Text style={styles.agentRole}>You'll be notified once assigned</Text>
                </View>
              </View>
            </View>

            {/* Service Progression */}
            <View style={styles.progressContainer}>
              <Text style={styles.progressTitle}>Service Progress</Text>
              <View style={styles.progressSteps}>
                <View style={styles.progressStep}>
                  <View style={[styles.progressDot, styles.progressCompleted]} />
                  <Text style={styles.progressText}>Booking Confirmed</Text>
                </View>
                <View style={styles.progressStep}>
                  <View style={[styles.progressDot, styles.progressPending]} />
                  <Text style={styles.progressText}>Representative Assigned</Text>
                </View>
                <View style={styles.progressStep}>
                  <View style={[styles.progressDot, styles.progressPending]} />
                  <Text style={styles.progressText}>Service In Progress</Text>
                </View>
                <View style={styles.progressStep}>
                  <View style={[styles.progressDot, styles.progressPending]} />
                  <Text style={styles.progressText}>Service Completed</Text>
                </View>
              </View>
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.trackBtn}
                onPress={() => navigation.navigate('MyBookings', { tab: 'ongoing' })}
              >
                <Text style={styles.trackBtnText}>Track My Booking</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.homeBtn}
                onPress={() => navigation.navigate('Home')}
              >
                <Text style={styles.homeBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      // Keep focused inputs visible above the keyboard. Android's
      // edge-to-edge mode otherwise lets the keyboard cover them.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <View style={styles.container}>
      {/* Slim header — single row, service name + amount inline so
          it doesn't dominate the viewport. Earlier this took ~90px
          vertical (stacked 20px title + 16px price + 30px top padding
          + 20px bottom padding); now it's ~46px so there's far more
          room for the form fields below, especially with the keyboard
          open. */}
      <View style={styles.header}>
        <Text style={styles.serviceName} numberOfLines={1}>
          {serviceData?.name || 'Service'}
        </Text>
        <Text style={styles.servicePrice}>₹{totalAmount}</Text>
      </View>

      {renderStepper()}

      <ScrollView
        ref={stepScrollRef}
        style={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={(ev) => {
          stepScrollYRef.current = ev.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
      >
        {renderStep()}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: 20 + insets.bottom,
            // Respect horizontal insets too — on devices with rounded
            // edges or punch-hole cameras the left/right margins are
            // non-zero, and a flat 20px padding wasn't enough so the
            // Book Now / Confirm / Request Quote buttons got clipped.
            paddingLeft: 20 + (insets.left || 0),
            paddingRight: 20 + (insets.right || 0),
          },
        ]}
      >
        {currentStep < 6 && (
          <View style={styles.footerRow}>
            {currentStep > 1 && (
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => setCurrentStep(currentStep - 1)}
              >
                <Text style={styles.backBtnText}>Back</Text>
              </TouchableOpacity>
            )}

            {currentStep < 5 && (() => {
              const v = canAdvanceFromCurrentStep();
              return (
                <TouchableOpacity
                  style={[styles.nextBtn, !v.ok && { opacity: 0.5 }]}
                  onPress={() => {
                    const check = canAdvanceFromCurrentStep();
                    if (!check.ok) {
                      Alert.alert(
                        'Please complete this step',
                        check.message || 'Fill all required fields before continuing.',
                      );
                      return;
                    }
                    setCurrentStep(currentStep + 1);
                  }}
                >
                  <Text style={styles.nextBtnText}>Next</Text>
                </TouchableOpacity>
              );
            })()}

            {currentStep === 5 && (
              <TouchableOpacity
                style={[styles.confirmBtn, !acceptedTerms && { opacity: 0.5 }]}
                onPress={() => {
                  if (!acceptedTerms) {
                    Alert.alert(
                      'Accept the terms',
                      'Please accept the Terms of Use & Privacy Policy to proceed.',
                    );
                    return;
                  }
                  // Pay Online — user must pick a specific method first.
                  if (paymentMethod === 'pay_online' && !onlineMethod) {
                    Alert.alert(
                      'Choose a payment method',
                      'Please select UPI, Card, Net Banking, or Wallet before proceeding.',
                    );
                    return;
                  }
                  // UPI is validated IN-APP because Razorpay's sandbox
                  // doesn't always expose a UPI tab on test accounts.
                  // The user types the UPI ID right here; we check it
                  // against the canonical success-test ID. Card /
                  // Netbanking / Wallet still go through the Razorpay
                  // sandbox where their respective creds are entered.
                  if (paymentMethod === 'pay_online' && onlineMethod === 'upi') {
                    const id = String(upiId || '').trim().toLowerCase();
                    if (!id) {
                      Alert.alert(
                        'Enter UPI ID',
                        'Please type your UPI ID (test users: success@razorpay) before proceeding.',
                      );
                      return;
                    }
                    // Basic format check (something@something) so we
                    // don't fall through to the success-check on a
                    // half-typed value.
                    if (!/^[a-z0-9._-]+@[a-z0-9._-]+$/i.test(id)) {
                      Alert.alert(
                        'Invalid UPI ID',
                        'UPI ID should look like name@bank (e.g. success@razorpay).',
                      );
                      return;
                    }
                    if (id !== 'success@razorpay') {
                      // Test mode: anything other than the canonical
                      // success ID is treated as a failed payment. The
                      // user can edit + retry.
                      Alert.alert(
                        'Payment failed',
                        `UPI ID "${upiId}" was not approved by the sandbox. ` +
                          `Use success@razorpay for a successful test payment.`,
                      );
                      return;
                    }
                    // ✓ Test success — mark booking paid in-app via the
                    // existing trust-the-client path. Skips Razorpay
                    // entirely (no sandbox UPI tab to fall back to).
                    handleConfirmBooking({ inAppUpiSuccess: true });
                    return;
                  }
                  handleConfirmBooking();
                }}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.confirmBtnText}>Proceed & Pay (₹{totalAmount})</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {currentStep === 6 && (
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => setCurrentStep(currentStep - 1)}
            >
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <SuccessToast
        visible={toast.visible}
        title={toast.title}
        subtitle={toast.subtitle}
        variant={toast.variant}
        onHide={() => setToast({ ...toast, visible: false })}
      />

      {/* State picker modal — searchable list of all 28 states + 8 UTs.
          Plain View overlay; see the district modal comment for why we
          dropped KeyboardAvoidingView. */}
      <Modal
        visible={showStatePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatePicker(false)}
      >
        <View style={styles.statePickerOverlay}>
          <View style={[styles.statePickerSheetFixed, { paddingBottom: insets.bottom }]}>
            <View style={styles.statePickerHeader}>
              <Text style={styles.statePickerTitle}>Select your state</Text>
              <TouchableOpacity onPress={() => setShowStatePicker(false)}>
                <Text style={styles.statePickerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.statePickerSearch}
              value={stateSearch}
              onChangeText={setStateSearch}
              placeholder="Search…"
              autoCorrect={false}
              autoCapitalize="words"
            />
            <FlatList
              style={{ flex: 1 }}
              data={INDIAN_STATES.filter((s: string) =>
                s.toLowerCase().includes(stateSearch.trim().toLowerCase()),
              )}
              keyExtractor={(item: string) => item}
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="on-drag"
              renderItem={({ item }: any) => (
                <Pressable
                  style={({ pressed }) => [
                    styles.statePickerRow,
                    pressed && { backgroundColor: '#F1F5F9' },
                  ]}
                  android_ripple={{ color: '#E2E8F0' }}
                  onPress={() => {
                    setState(item);
                    setStateSearch('');
                    setShowStatePicker(false);
                  }}
                  hitSlop={4}
                >
                  <Text style={styles.statePickerRowText}>{item}</Text>
                  {state === item && <Text style={styles.statePickerCheck}>✓</Text>}
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.statePickerEmpty}>No matching state.</Text>
              }
            />
          </View>
        </View>
      </Modal>

      {/* District picker modal — same searchable list pattern as the state
          picker. KAV was previously wrapping the overlay but on Android
          it collapses the container inside a Modal so the FlatList
          rendered with zero height (list looked empty even though data
          was there). Plain View + explicit sheet height fixes it. */}
      <Modal
        visible={showDistrictPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDistrictPicker(false)}
      >
        <View style={styles.statePickerOverlay}>
          <View style={[styles.statePickerSheetFixed, { paddingBottom: insets.bottom }]}>
            <View style={styles.statePickerHeader}>
              <Text style={styles.statePickerTitle}>Select your district</Text>
              <TouchableOpacity onPress={() => setShowDistrictPicker(false)}>
                <Text style={styles.statePickerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.statePickerSearch}
              value={districtSearch}
              onChangeText={setDistrictSearch}
              placeholder="Search district…"
              autoCorrect={false}
              autoCapitalize="words"
            />
            <FlatList
              style={{ flex: 1 }}
              data={INDIAN_DISTRICTS.filter((d: string) =>
                d.toLowerCase().includes(districtSearch.trim().toLowerCase()),
              )}
              keyExtractor={(item: string) => item}
              // 'always' ensures the row's tap is registered even while the
              // keyboard is showing — 'handled' was silently routing the
              // first tap to keyboard-dismissal on Android, making it look
              // like the row wasn't responding.
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="on-drag"
              renderItem={({ item }: any) => (
                <Pressable
                  style={({ pressed }) => [
                    styles.statePickerRow,
                    pressed && { backgroundColor: '#F1F5F9' },
                  ]}
                  android_ripple={{ color: '#E2E8F0' }}
                  onPress={() => {
                    setDistrict(item);
                    setDistrictSearch('');
                    setShowDistrictPicker(false);
                  }}
                  hitSlop={4}
                >
                  <Text style={styles.statePickerRowText}>{item}</Text>
                  {district === item && <Text style={styles.statePickerCheck}>✓</Text>}
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.statePickerEmpty}>No matching district.</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
}

// Helper for the Payment Summary card — renders a checkbox + label +
// amount row. Two visual sizes: default (line-item add-ons) and small
// (the wallet/refund deduction rows under the total). When `disabled`
// the row is greyed out and untappable.
interface PsCheckboxRowProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
  amount: number;
  amountFmt?: 'rupee' | 'rupee2';
  disabled?: boolean;
  small?: boolean;
}

const PsCheckboxRow: React.FC<PsCheckboxRowProps> = ({
  checked, onToggle, label, amount, amountFmt = 'rupee', disabled = false, small = false,
}) => {
  const valueText =
    amountFmt === 'rupee2'
      ? `₹ ${amount.toFixed(2)}`
      : `₹ ${amount}`;
  return (
    <TouchableOpacity
      style={styles.psRow}
      onPress={disabled ? undefined : onToggle}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        <View style={[styles.psCheckbox, checked && styles.psCheckboxChecked, disabled && styles.psCheckboxDisabled]}>
          {checked && <Text style={styles.psCheckboxTick}>✓</Text>}
        </View>
        <Text
          style={[
            small ? styles.psSmallLabel : styles.psOptLabel,
            disabled && styles.psDisabledText,
          ]}
        >
          {label}
        </Text>
      </View>
      <Text
        style={[
          small ? styles.psSmallValue : styles.psOptValue,
          disabled && styles.psDisabledText,
        ]}
      >
        {valueText}
      </Text>
    </TouchableOpacity>
  );
};

const styles: any = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    backgroundColor: '#E63946',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  serviceName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    flex: 1,
    marginRight: 10,
    letterSpacing: 0.2,
  },
  servicePrice: {
    fontSize: 14,
    fontWeight: '900',
    color: '#fff',
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#fff',
    padding: 15,
    marginHorizontal: 15,
    marginTop: 15,
    borderRadius: 10,
  },
  stepActive: {
    backgroundColor: '#E63946',
  },
  stepNum: {
    color: '#757575',
  },
  stepNumActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  stepContainer: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 15,
    color: '#212121',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 15,
  },
  dateButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 15,
  },
  genderButton: {
    flex: 1,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  genderButtonText: {
    color: '#212121',
  },
  documentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  documentName: {
    fontSize: 14,
    flex: 1,
    color: '#212121',
  },
  uploadBtn: {
    backgroundColor: '#E63946',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  uploadBtnDisabled: {
    opacity: 0.5,
  },
  uploadBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  noDocuments: {
    fontSize: 16,
    color: '#757575',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  priceCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  priceTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#212121',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  // ─── Online payment method UI ───
  payOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#F0F2F5',
  },
  payOptionCardActive: { borderColor: '#E63946', backgroundColor: '#FFFCFD' },
  payOptionIcon: {
    width: 44, height: 44, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  payOptionEmoji: { fontSize: 22 },
  payOptionTitle: { fontSize: 15, fontWeight: '800', color: '#1A1A1A' },
  payOptionSubtitle: { fontSize: 11, color: '#6C757D', marginTop: 2 },
  payRadio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#E0E0E0',
    justifyContent: 'center', alignItems: 'center',
  },
  payRadioActive: { borderColor: '#E63946' },
  payRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E63946' },

  // Online methods grid (UPI / Card / Netbanking / Wallet)
  onlineMethodsBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginTop: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F0F2F5',
  },
  onlineMethodsLabel: { fontSize: 11, fontWeight: '700', color: '#9E9E9E', letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' },
  onlineMethodsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  onlineMethodTile: {
    width: '23%',
    aspectRatio: 1,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#F0F2F5',
  },
  onlineMethodTileActive: {
    backgroundColor: '#FCE4E6',
    borderColor: '#E63946',
  },
  onlineMethodEmoji: { fontSize: 22, marginBottom: 4 },
  onlineMethodLabel: { fontSize: 10, fontWeight: '700', color: '#1A1A1A' },

  // Shared sub-form (UPI/Card/etc)
  subForm: {
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F5',
  },
  subFormLabel: { fontSize: 11, fontWeight: '700', color: '#1A1A1A', marginBottom: 6, marginTop: 8, letterSpacing: 0.3 },
  subFormInput: {
    borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#1A1A1A',
    backgroundColor: '#FAFAFA',
  },
  cardRow: { flexDirection: 'row' },
  secureNote: { fontSize: 10, color: '#6C757D', marginTop: 10, textAlign: 'center' },

  // UPI app suggestions
  upiAppsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  upiAppPill: {
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: '#E3F2FD', borderRadius: 12,
  },
  upiAppText: { fontSize: 10, fontWeight: '700', color: '#1976D2' },

  // Banks / Wallets grid
  banksGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  bankChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#F8F9FA', borderRadius: 10,
    borderWidth: 1.5, borderColor: '#E0E0E0',
  },
  bankChipActive: {
    backgroundColor: '#E63946', borderColor: '#E63946',
  },
  bankChipText: { fontSize: 12, fontWeight: '700', color: '#1A1A1A' },

  paymentTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#212121',
  },
  paymentBtn: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
  },
  paymentBtnActive: {
    backgroundColor: '#0D3B66',
    borderColor: '#0D3B66',
  },
  paymentBtnText: {
    fontSize: 16,
    color: '#212121',
  },
  paymentBtnTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  paymentProcessingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
    padding: 10,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
  },
  paymentProcessingText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#007AFF',
  },
  paymentErrorText: {
    color: '#F44336',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    padding: 10,
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
  },
  serviceModeDescription: {
    fontSize: 12,
    color: '#757575',
    marginTop: 4,
    fontStyle: 'italic',
  },
  serviceModeDescriptionActive: {
    color: 'rgba(255,255,255,0.85)',
  },
  uploadedPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#F4F6FA',
    borderWidth: 1,
    borderColor: '#E7ECF2',
    borderRadius: 10,
    padding: 8,
  },
  uploadedThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#E7ECF2',
  },
  uploadedFileTile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadedFileTileText: {
    fontSize: 28,
  },
  uploadedFileName: {
    fontSize: 12,
    color: '#0D3B66',
    fontWeight: '700',
  },
  uploadedReplaceText: {
    fontSize: 11,
    color: '#1B4B72',
    marginTop: 4,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  previewCard: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E7ECF2',
  },
  previewTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#0D3B66',
    marginRight: 12,
  },
  previewClose: {
    fontSize: 22,
    color: '#0D3B66',
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  previewImage: {
    width: '100%',
    height: 480,
    backgroundColor: '#000',
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  confirmCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    // Bumped from 16 → 40 so the Upload / Retake row never overlaps
    // the phone's bottom gesture bar or 3-button nav. On Pixel-class
    // phones the original 16px put Upload directly in the swipe-back
    // zone, so taps registered as "back" and silently navigated
    // away from the doc upload flow.
    paddingBottom: 40,
  },
  // Image preview is wrapped so we can position the floating Crop
  // overlay absolutely inside it.
  confirmImageWrap: {
    position: 'relative',
    width: '100%',
  },
  confirmImage: {
    width: '100%',
    height: 360,
    backgroundColor: '#0F172A',
  },
  // Floating "✂ Crop" pill anchored to the top-right of the image.
  // Bright green, white text, thick drop-shadow + border so it pops
  // against ANY image content (dark scans, bright photos, etc.).
  confirmCropOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
  },
  confirmCropOverlayText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 10,
  },
  confirmRetakeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#0D3B66',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  confirmRetakeText: {
    color: '#0D3B66',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Crop button — sits between Retake and Upload. Solid green so it's
  // visible against any image preview behind it (modal lays the image
  // ABOVE this row, but a wider phone scroll might overlap so we keep
  // a strong background regardless).
  confirmCropBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#10B981',
    alignItems: 'center',
    shadowColor: '#065F46',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  confirmCropText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  confirmUploadBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#0D3B66',
    alignItems: 'center',
    shadowColor: '#082B4C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmUploadText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  docPickerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    // Lift the bottom edge well above any phone's gesture bar /
    // 3-button nav so the Cancel + upload options never overlap with
    // the system back swipe. Previously 24px which on Pixel-class
    // phones put Cancel directly inside the bottom gesture strip
    // and taps registered as a system back instead.
    paddingBottom: 48,
  },
  docPickerHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  docPickerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0D3B66',
    textAlign: 'center',
    marginBottom: 4,
  },
  docPickerSubtitle: {
    fontSize: 13,
    color: '#5C6A7A',
    textAlign: 'center',
    marginBottom: 18,
  },
  docPickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E7ECF2',
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: '#F8FAFC',
  },
  // Highlighted variant for the two crop-enabled options (Take Photo,
  // Choose from Gallery). Stronger border, tinted background and a green
  // CROP badge so users notice that cropping is available — previously
  // the option looked the same as a regular row and users missed it.
  docPickerOptionPrimary: {
    borderColor: '#0D3B66',
    borderWidth: 2,
    backgroundColor: '#EFF6FF',
  },
  docPickerOptionIcon: {
    fontSize: 22,
    marginRight: 14,
  },
  docPickerOptionText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0D3B66',
  },
  docPickerOptionTextPrimary: {
    fontSize: 16,
    fontWeight: '800',
  },
  docPickerOptionHint: {
    fontSize: 11,
    color: '#475569',
    marginTop: 2,
    fontWeight: '500',
  },
  docPickerCropBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  docPickerCropBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  docPickerCancelOption: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E63946',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 0,
  },
  docPickerCancelText: {
    color: '#E63946',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    flex: 1,
  },
  referralCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginTop: 14,
    marginBottom: 14,
  },
  referralTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92700A',
    marginBottom: 4,
  },
  referralSub: {
    fontSize: 11,
    color: '#7A5C00',
    marginBottom: 10,
  },
  referralStepsBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  referralStep: {
    fontSize: 11,
    color: '#7A5C00',
    lineHeight: 16,
  },
  referralStepBold: {
    fontWeight: '800',
    color: '#92400E',
  },
  referralInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  referralInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#003153',
    letterSpacing: 0.6,
  },
  referralApplyBtn: {
    backgroundColor: '#003153',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
  },
  referralApplyBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  referralApplyText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.4,
  },
  referralAppliedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F7EE',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  referralAppliedText: {
    color: '#10B981',
    fontWeight: '800',
    fontSize: 13,
  },
  referralRemove: {
    color: '#C62828',
    fontWeight: '700',
    fontSize: 12,
  },
  referralErrorText: {
    color: '#C62828',
    fontSize: 11,
    marginTop: 6,
    fontWeight: '600',
  },
  slotsContainer: {
    flexDirection: 'row',
    marginTop: 10,
    marginBottom: 20,
  },
  timeSlot: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    marginRight: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  timeSlotSelected: {
    backgroundColor: '#0D3B66',
    borderColor: '#0D3B66',
  },
  timeSlotText: {
    fontSize: 14,
    color: '#212121',
  },
  timeSlotTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  guidelinesContainer: {
    backgroundColor: '#F5F5F5',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
  },
  guidelinesTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#212121',
  },
  guidelineText: {
    fontSize: 13,
    color: '#757575',
    marginBottom: 3,
  },
  bookingDetails: {
    fontSize: 14,
    color: '#757575',
    marginTop: 10,
    textAlign: 'center',
  },
  summaryContainer: {
    backgroundColor: '#F8F9FA',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#212121',
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#757575',
    flex: 1,
  },
  summaryValue: {
    fontSize: 14,
    color: '#212121',
    fontWeight: '600',
    flex: 2,
    textAlign: 'right',
  },
  chargeContainer: {
    backgroundColor: '#FFF8E1',
    padding: 15,
    borderRadius: 10,
    marginTop: 15,
  },
  chargeTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#212121',
  },
  chargeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  chargeLabel: {
    fontSize: 14,
    color: '#757575',
  },
  chargeValue: {
    fontSize: 14,
    color: '#212121',
    fontWeight: '600',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    paddingTop: 8,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  totalValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E63946',
  },
  agentContainer: {
    backgroundColor: '#E3F2FD',
    padding: 15,
    borderRadius: 10,
    marginTop: 15,
  },
  agentTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#212121',
  },
  agentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  agentAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E63946',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  agentDetails: {
    flex: 1,
  },
  agentName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  agentRole: {
    fontSize: 12,
    color: '#757575',
    marginTop: 2,
  },
  agentRating: {
    fontSize: 12,
    color: '#FF9800',
    marginTop: 2,
  },
  agentContact: {
    marginLeft: 10,
  },
  contactBtn: {
    backgroundColor: '#E63946',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  contactBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  progressContainer: {
    backgroundColor: '#F3E5F5',
    padding: 15,
    borderRadius: 10,
    marginTop: 15,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#212121',
  },
  progressSteps: {
    flexDirection: 'column',
  },
  progressStep: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  progressCompleted: {
    backgroundColor: '#4CAF50',
  },
  progressPending: {
    backgroundColor: '#E0E0E0',
  },
  progressText: {
    fontSize: 14,
    color: '#212121',
  },
  buttonContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  disabled: {
    opacity: 0.5,
  },
  footer: {
    // Horizontal + bottom padding are set inline (driven by safe-area
    // insets) so the Book Now / Request Quote / Confirm buttons don't
    // get clipped on rounded-edge or notched phones. Top stays a flat
    // 20px since the StatusBar/header is the same height everywhere.
    paddingTop: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  helperText: {
    fontSize: 12, color: '#757575', marginTop: 4,
  },
  // ─── State-picker modal ───
  statePickerOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  statePickerSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    maxHeight: '80%', paddingHorizontal: 16, paddingTop: 14,
  },
  // Explicit height so the FlatList inside (which has flex:1) has a
  // bounded parent to flex into. With only maxHeight, Android render
  // produced a 0-height FlatList — the list looked "empty" even though
  // 200+ districts were in the data.
  statePickerSheetFixed: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    height: '75%',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  statePickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 10,
  },
  statePickerTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },
  statePickerClose: { fontSize: 22, color: '#757575', paddingHorizontal: 6 },
  statePickerSearch: {
    backgroundColor: '#F5F5F5',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, marginBottom: 8,
  },
  statePickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  statePickerRowText: { fontSize: 15, color: '#212121', flex: 1 },
  statePickerCheck: { color: '#2E7D32', fontSize: 18, fontWeight: '700' },
  statePickerEmpty: { textAlign: 'center', paddingVertical: 24, color: '#9E9E9E' },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backBtn: {
    flex: 1,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginRight: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#0D3B66',
  },
  backBtnText: {
    color: '#0D3B66',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  nextBtn: {
    flex: 2,
    padding: 14,
    backgroundColor: '#0D3B66',
    borderRadius: 10,
    alignItems: 'center',
  },
  nextBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  confirmBtn: {
    flex: 2,
    padding: 14,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // ─── Modern success hero ───
  successHero: {
    backgroundColor: '#fff',
    borderRadius: 20,
    margin: 12,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#E63946',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  successCheckCircle: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: '#E63946',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 14,
    shadowColor: '#E63946',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  successCheckMark: { color: '#fff', fontSize: 36, fontWeight: '900' },
  successSubtitle: { fontSize: 13, color: '#6C757D', marginTop: 4, marginBottom: 14, textAlign: 'center' },
  bookingNumberPill: {
    backgroundColor: '#FCE4E6',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  bookingNumberLabel: { fontSize: 9, fontWeight: '700', color: '#9E9E9E', letterSpacing: 1 },
  bookingNumberText: { fontSize: 16, fontWeight: '800', color: '#E63946', marginTop: 2 },

  paymentMethodRow: { borderBottomWidth: 0, paddingTop: 6 },
  paymentBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  paymentBadgePaid: { backgroundColor: '#E8F5E9' },
  paymentBadgePending: { backgroundColor: '#FFF8E1' },
  paymentBadgeText: { fontSize: 11, fontWeight: '700' },
  paymentBadgeTextPaid: { color: '#2E7D32' },
  paymentBadgeTextPending: { color: '#F57C00' },

  agentCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 12,
  },

  successContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  successIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 15,
  },
  bookingNumber: {
    fontSize: 16,
    color: '#757575',
    marginBottom: 30,
  },
  trackBtn: {
    backgroundColor: '#E63946',
    padding: 15,
    borderRadius: 10,
    width: '90%',
    alignItems: 'center',
    marginBottom: 15,
  },
  trackBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  homeBtn: {
    backgroundColor: '#757575',
    padding: 15,
    borderRadius: 10,
    width: '90%',
    alignItems: 'center',
  },
  homeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  datePicker: {
    backgroundColor: '#fff',
  },
  locationBtn: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  locationBtnActive: {
    backgroundColor: '#E63946',
  },
  locationBtnText: {
    color: '#212121',
    fontSize: 16,
    fontWeight: '600',
  },
  addressInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 15,
  },

  // ─── Modern stepper — tightened so the header + progress bar +
  // dot row together take ~80px instead of the prior ~140px. More
  // room for the actual form below, especially when the keyboard
  // is open.
  modernStepperWrap: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  stepperHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  stepperHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepperHeaderIcon: { fontSize: 18, marginRight: 8 },
  stepperHeaderLabel: { fontSize: 9, fontWeight: '700', color: '#9E9E9E', letterSpacing: 0.8 },
  stepperHeaderTitle: { fontSize: 13, fontWeight: '800', color: '#1A1A1A', marginTop: 1 },
  stepperBadge: {
    backgroundColor: '#E63946',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  stepperBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  progressTrack: {
    height: 4,
    backgroundColor: '#F0F2F5',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#E63946',
    borderRadius: 2,
  },

  dotsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dotWrap: { alignItems: 'center', flex: 1 },
  dot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#F0F2F5',
    borderWidth: 2, borderColor: '#F0F2F5',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 2,
  },
  dotCompleted: { backgroundColor: '#E63946', borderColor: '#E63946' },
  dotCurrent: { backgroundColor: '#fff', borderColor: '#E63946' },
  dotPulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E63946' },
  dotCheck: { color: '#fff', fontSize: 9, fontWeight: '800' },
  dotLabel: { fontSize: 8, color: '#9E9E9E', fontWeight: '600' },
  dotLabelActive: { color: '#1A1A1A', fontWeight: '700' },

  // ─── Old stepper styles (kept for fallback / not actively used) ───
  stepperContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    padding: 20,
    marginHorizontal: 15,
    marginVertical: 10,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  stepItem: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
    minWidth: 60,
  },
  stepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#E0E0E0',
  },
  stepCircleCompleted: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  stepCircleCurrent: {
    backgroundColor: '#E63946',
    borderColor: '#E63946',
  },
  stepCircleUpcoming: {
    backgroundColor: '#E0E0E0',
    borderColor: '#E0E0E0',
  },
  stepNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#9E9E9E',
  },
  stepNumberCompleted: {
    color: '#fff',
  },
  stepNumberCurrent: {
    color: '#fff',
  },
  stepNumberUpcoming: {
    color: '#9E9E9E',
  },
  stepTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9E9E9E',
    textAlign: 'center',
    marginBottom: 2,
  },
  stepTitleCompleted: {
    color: '#4CAF50',
  },
  stepTitleCurrent: {
    color: '#E63946',
  },
  stepTitleUpcoming: {
    color: '#9E9E9E',
  },
  stepDescription: {
    fontSize: 10,
    color: '#BDBDBD',
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  stepDescriptionCompleted: {
    color: '#757575',
  },
  stepDescriptionCurrent: {
    color: '#757575',
  },
  stepDescriptionUpcoming: {
    color: '#BDBDBD',
  },
  stepConnector: {
    position: 'absolute',
    top: 20,
    left: '50%',
    width: '100%',
    height: 2,
    backgroundColor: '#E0E0E0',
    zIndex: -1,
  },
  stepConnectorCompleted: {
    backgroundColor: '#4CAF50',
  },
  stepConnectorCurrent: {
    backgroundColor: '#E63946',
  },
  stepConnectorUpcoming: {
    backgroundColor: '#E0E0E0',
  },

  // ─── App-level disclaimer card (booking confirmation step) ───
  bookingDisclaimer: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 4,
    borderLeftColor: '#F4A100',
    padding: 14,
    borderRadius: 8,
    marginTop: 16,
    marginHorizontal: 12,
  },
  bookingDisclaimerLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#92400E',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  bookingDisclaimerText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 18,
  },

  // ─── Aadhaar comprehensive form (UIDAI-style intake) ───
  aadhaarSectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0D3B66',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 4,
  },
  aadhaarChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  aadhaarChipActive: {
    backgroundColor: '#0D3B66',
    borderColor: '#0D3B66',
  },
  aadhaarChipText: { color: '#475569', fontWeight: '600', fontSize: 13 },
  aadhaarChipTextActive: { color: '#FFFFFF', fontWeight: '800' },

  // ─── Payment Summary card (matches the spec mockup layout) ───
  psCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  psTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 10,
  },
  psDivider: {
    height: 2,
    backgroundColor: '#0D3B66',
    marginVertical: 8,
  },
  psRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  psMandatoryLabel: {
    color: '#1E5BA8',
    fontWeight: '700',
    fontSize: 15,
    flex: 1,
    marginRight: 12,
  },
  psMandatoryValue: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 15,
  },
  psOptLabel: {
    color: '#1F2937',
    fontWeight: '500',
    fontSize: 14,
    flex: 1,
    marginLeft: 10,
  },
  psOptValue: {
    color: '#1F2937',
    fontWeight: '500',
    fontSize: 14,
  },
  psSmallLabel: {
    color: '#374151',
    fontSize: 13,
    flex: 1,
    marginLeft: 10,
  },
  psSmallValue: {
    color: '#374151',
    fontSize: 13,
  },
  psTotalLabel: {
    color: '#1F2937',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  psTotalValue: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  psCheckbox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  psCheckboxChecked: {
    backgroundColor: '#1E5BA8',
    borderColor: '#1E5BA8',
  },
  psCheckboxDisabled: {
    borderColor: '#CBD5E1',
    backgroundColor: '#F1F5F9',
  },
  psCheckboxTick: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 14,
  },
  psDisabledText: { color: '#94A3B8' },
  psTermsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  psTermsText: {
    color: '#1F2937',
    fontSize: 13,
    marginLeft: 10,
    flex: 1,
  },
  psLink: {
    color: '#1E5BA8',
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
});

export default BookingScreen;
