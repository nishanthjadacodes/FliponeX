import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Modal,
  FlatList,
  Image,
} from 'react-native';

// Indian states + UTs — used by the Domicile / address forms below as a
// dropdown so users don't have to type / typo the state name.
const INDIAN_STATES: string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  // Union Territories
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatBookingId, nextLocalBookingNumber } from '../utils/bookingId';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
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
import { getUser } from '../utils/storage';
import RazorpayCheckout from 'react-native-razorpay';
import { createBooking, getLocationFromAddress, uploadDocument, getProfile, processPayment, createPaymentOrder, verifyPayment, applyReferralCode } from '../services/api';
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
  const { serviceData } = route.params;

  // State for multi-step form
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [userMobile, setUserMobile] = useState<string>('');

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
  const [dateOfBirth, setDateOfBirth] = useState<Date>(new Date());
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
            <Text>{dateOfBirth.toLocaleDateString()}</Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={dateOfBirth}
              mode="date"
              display="default"
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
          <TextInput
            style={styles.input}
            placeholder="Enter your district"
            value={district}
            onChangeText={setDistrict}
          />
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

  // Calculate pricing — parse as numbers since API returns decimal strings
  const userCost = parseFloat(serviceData?.user_cost) || 0;
  const govtFees = parseFloat(serviceData?.govt_fees) || 0;
  const additionalFee = serviceMode === 'fast_track' ? priorityFee : 0;
  const totalAmount = Math.max(0, userCost + govtFees + additionalFee - referralDiscount);

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
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Camera access is needed to take a photo of your document.');
        return;
      }
      // Use the in-picker crop tool (allowsEditing) AND show our own
      // preview/confirm modal afterwards. This way:
      //   - Users who can see the native Crop UI get to crop in-place.
      //   - Users on devices where the cropper's confirm button is hidden
      //     (Android edge-to-edge gesture-nav bug) still get a clear
      //     "Upload" submit button on our preview modal.
      const result: any = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images' as any,
        allowsEditing: true,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setPendingImage({
        documentType,
        file: {
          uri: result.assets[0].uri,
          name: `document_${documentType}_${Date.now()}.jpg`,
          type: 'image/jpeg',
        },
      });
    } catch (e: any) {
      console.error('camera pick error:', e);
      showToast('Camera error', e?.message || 'Could not open camera', 'error');
    }
  };

  const pickFromGallery = async (documentType: string): Promise<void> => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Gallery access is needed to pick an image.');
        return;
      }
      const result: any = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images' as any,
        allowsEditing: true,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setPendingImage({
        documentType,
        file: {
          uri: result.assets[0].uri,
          name: `document_${documentType}_${Date.now()}.jpg`,
          type: 'image/jpeg',
        },
      });
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
        // SDK rejects with either {code, description} (cancel) or
        // {error: {code, description, reason, ...}} (gateway failure).
        // Try the message field too — it sometimes holds a JSON-encoded blob.
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
        if (code === 0 || code === 2 || /cancel/i.test(description)) {
          Alert.alert('Payment cancelled', 'You can retry from the same screen.');
        } else {
          Alert.alert('Payment failed', description);
        }
        throw new Error(description);
      }

      // 3. Send signature to backend for HMAC verification + Razorpay
      //    payment-status fetch. Only then is the booking marked paid.
      const verifyRes: any = await verifyPayment({
        booking_id: bookingId,
        razorpay_order_id: checkoutResp.razorpay_order_id,
        razorpay_payment_id: checkoutResp.razorpay_payment_id,
        razorpay_signature: checkoutResp.razorpay_signature,
      });

      if (!verifyRes?.success) {
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

  // Slot Booking Functions
  const generateTimeSlots = (date: any): any[] => {
    const slots: any[] = [];
    const startHour = 7; // 7:00 AM
    const endHour = 19; // 7:00 PM (last slot starts at 6:00 PM)

    for (let hour = startHour; hour < endHour; hour++) {
      const startTime = `${hour.toString().padStart(2, '0')}:00`;
      const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;

      slots.push({
        id: `${startTime}-${endTime}`,
        startTime,
        endTime,
        display: `${startTime} - ${endTime}`
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

  const validateWorkingHours = (selectedDateTime: any): any => {
    const hour = selectedDateTime.getHours();
    const dayOfWeek = selectedDateTime.getDay();

    // Check if it's a weekday (Monday-Friday)
    if (dayOfWeek === 0 || dayOfWeek === 6) { // Sunday or Saturday
      return {
        valid: false,
        message: 'Bookings are only available on weekdays (Monday-Friday)'
      };
    }

    // Check if within working hours (7:00 AM - 7:00 PM)
    if (hour < 7 || hour >= 19) {
      return {
        valid: false,
        message: 'Bookings are only available between 7:00 AM and 7:00 PM'
      };
    }

    // Additional check for fast-track service (9:00 AM - 6:00 PM)
    if (serviceMode === 'fast_track' && (hour < 9 || hour >= 18)) {
      return {
        valid: false,
        message: 'Fast-track service is only available between 9:00 AM and 6:00 PM'
      };
    }

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

  const handleConfirmBooking = async (): Promise<void> => {
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

      // Create booking data object first
      const bookingData: any = {
        id: Date.now().toString(),
        service_id: serviceData?.id,
        service_name: serviceData?.name || '',
        booking_type: 'consumer',
        customer_name: resolvedCustomerName,
        applicant_name: applicantName,
        aadhaar_number: aadhaarNumber,
        mobile: mobile || userMobile,
        date_of_birth: dateOfBirth,
        address: address,
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
        additional_fee: additionalFee,
        status: 'confirmed',
        created_at: new Date().toISOString(),
        booking_number: `BK${await nextLocalBookingNumber()}`,
        document_ids: sessionDocIds,
        // Whatever the customer typed into backend-defined form fields.
        // Backend persists these on the booking row so admins see exactly
        // what was provided per service.
        dynamic_fields: dynamicFieldValues,
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

      // Deferred-online flow: NEVER trigger Razorpay at booking creation.
      // The actual checkout fires later from BookingDetails when the
      // representative marks status = completed. So treat every booking
      // confirmation the same — save locally + show success.
      addBookingToAgentapp();
      setCurrentStep(6);
      const localNum = await nextLocalBookingNumber();
      setBookingNumber(`BK${localNum}`);

      const agentLine = assignedAgentName
        ? `\n\nAssigned Representative: ${assignedAgentName}`
        : '\n\nA representative will be assigned shortly.';
      Alert.alert(
        'Booking Confirmed!',
        `Your booking has been confirmed successfully.\n\nBooking Number: ${formatBookingId(`BK${localNum}`)}${agentLine}\n\nYou'll be asked to pay only after the work is complete.`,
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.navigate('MyBookings');
            },
          },
        ]
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

      case 2:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Personal Details</Text>

            {/* Only show fields mentioned in service description */}
            {renderDynamicFormFields()}
          </View>
        );

      case 3: {
        // Backend returns service.required_documents in two different shapes
        // depending on which seed created the row:
        //   1. Plain array: [{type, label, required}, ...]
        //   2. Wrapped object: { documents: [{type, label, required}, ...] }
        // Normalise to a single array before rendering so the upload list
        // actually shows up (previous code only handled shape #1).
        const rawDocs = serviceData?.required_documents;
        const requiredDocs: any[] = Array.isArray(rawDocs)
          ? rawDocs
          : Array.isArray(rawDocs?.documents)
          ? rawDocs.documents
          : [];

        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Required Documents</Text>

            {requiredDocs.length > 0 ? (
              requiredDocs.map((doc: any, index: number) => {
                const type = doc?.type || `doc_${index}`;
                const label = doc?.label || doc?.type || `Document ${index + 1}`;
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
                    style={styles.docPickerOption}
                    onPress={() => {
                      const dt = docPickerFor;
                      setDocPickerFor(null);
                      if (dt) pickFromCamera(dt);
                    }}
                  >
                    <Text style={styles.docPickerOptionIcon}>📷</Text>
                    <Text style={styles.docPickerOptionText}>Take Photo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.docPickerOption}
                    onPress={() => {
                      const dt = docPickerFor;
                      setDocPickerFor(null);
                      if (dt) pickFromGallery(dt);
                    }}
                  >
                    <Text style={styles.docPickerOptionIcon}>🖼</Text>
                    <Text style={styles.docPickerOptionText}>Choose from Gallery</Text>
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
                  <View style={styles.confirmActionsRow}>
                    <TouchableOpacity
                      style={styles.confirmRetakeBtn}
                      onPress={() => {
                        const dt = pendingImage?.documentType;
                        setPendingImage(null);
                        if (dt) handleDocumentUpload(dt);
                      }}
                    >
                      <Text style={styles.confirmRetakeText}>Retake / Re-pick</Text>
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
                      <Text style={styles.confirmUploadText}>Upload Document</Text>
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

            {/* Service Mode (Offline / Online) */}
            <Text style={styles.label}>Service Mode</Text>
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
                Standard processing. Book 4+ hours in advance (7:00 AM – 7:00 PM).
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
                Service within 90 minutes (9:00 AM – 6:00 PM).
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

            {/* Booking Guidelines */}
            <View style={styles.guidelinesContainer}>
              <Text style={styles.guidelinesTitle}>📋 Booking Guidelines</Text>
              <Text style={styles.guidelineText}>• Booking window: 24 hours</Text>
              <Text style={styles.guidelineText}>• Regular: 4+ hours advance booking</Text>
              <Text style={styles.guidelineText}>• Fast-track: 90+ minutes advance booking</Text>
              <Text style={styles.guidelineText}>• Maximum: 7 days advance booking</Text>
              <Text style={styles.guidelineText}>• Working hours: 7:00 AM - 7:00 PM</Text>
              <Text style={styles.guidelineText}>• 30-minute buffer between bookings</Text>
            </View>
          </View>
        );

      case 5:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Payment Options</Text>

            <View style={styles.priceCard}>
              <Text style={styles.priceTitle}>Amount Breakdown</Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>User Cost:</Text>
                <Text style={styles.priceValue}>₹{userCost}</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Govt Fees:</Text>
                <Text style={styles.priceValue}>₹{govtFees}</Text>
              </View>
              {serviceMode === 'fast_track' && (
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Priority Fee:</Text>
                  <Text style={styles.priceValue}>₹{priorityFee}</Text>
                </View>
              )}
              {referralDiscount > 0 && (
                <View style={styles.priceRow}>
                  <Text style={[styles.priceLabel, { color: '#2E7D32' }]}>Referral Discount:</Text>
                  <Text style={[styles.priceValue, { color: '#2E7D32' }]}>−₹{referralDiscount}</Text>
                </View>
              )}
              <View style={[styles.priceRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total Amount:</Text>
                <Text style={styles.totalValue}>₹{totalAmount}</Text>
              </View>
            </View>

            {/* Have a referral code? — spec H, applies on first booking only */}
            <View style={styles.referralCard}>
              <Text style={styles.referralTitle}>🎁 Have a Referral Code?</Text>
              <Text style={styles.referralSub}>
                Enter your friend's code to get ₹20 off your first booking.
              </Text>
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
                <Text style={styles.payOptionTitle}>Pay Online After Completion</Text>
                <Text style={styles.payOptionSubtitle}>
                  UPI / Cards / Netbanking / Wallets — pay only after the
                  representative completes the work. No money charged at booking.
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
                    { key: 'upi',        icon: '🏦', label: 'UPI' },
                    { key: 'card',       icon: '💳', label: 'Card' },
                    { key: 'netbanking', icon: '🏧', label: 'Netbanking' },
                    { key: 'wallet',     icon: '👛', label: 'Wallet' },
                  ].map((m: any) => (
                    <TouchableOpacity
                      key={m.key}
                      style={[styles.onlineMethodTile, onlineMethod === m.key && styles.onlineMethodTileActive]}
                      onPress={() => setOnlineMethod(m.key)}
                    >
                      <Text style={styles.onlineMethodEmoji}>{m.icon}</Text>
                      <Text style={[styles.onlineMethodLabel, onlineMethod === m.key && { color: '#E63946' }]}>{m.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* UPI form */}
                {onlineMethod === 'upi' && (
                  <View style={styles.subForm}>
                    <Text style={styles.subFormLabel}>Enter your UPI ID</Text>
                    <TextInput
                      style={styles.subFormInput}
                      placeholder="yourname@okhdfcbank"
                      value={upiId}
                      onChangeText={setUpiId}
                      autoCapitalize="none"
                      placeholderTextColor="#9E9E9E"
                    />
                    <View style={styles.upiAppsRow}>
                      {['Google Pay', 'PhonePe', 'Paytm', 'BHIM'].map(app => (
                        <View key={app} style={styles.upiAppPill}>
                          <Text style={styles.upiAppText}>{app}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Card form */}
                {onlineMethod === 'card' && (
                  <View style={styles.subForm}>
                    <Text style={styles.subFormLabel}>Card Number</Text>
                    <TextInput
                      style={styles.subFormInput}
                      placeholder="1234 5678 9012 3456"
                      value={cardNumber}
                      onChangeText={(v: string) => setCardNumber(v.replace(/[^0-9 ]/g, '').slice(0, 19))}
                      keyboardType="number-pad"
                      maxLength={19}
                      placeholderTextColor="#9E9E9E"
                    />
                    <Text style={styles.subFormLabel}>Cardholder Name</Text>
                    <TextInput
                      style={styles.subFormInput}
                      placeholder="As printed on card"
                      value={cardHolderName}
                      onChangeText={setCardHolderName}
                      placeholderTextColor="#9E9E9E"
                    />
                    <View style={styles.cardRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={styles.subFormLabel}>Expiry (MM/YY)</Text>
                        <TextInput
                          style={styles.subFormInput}
                          placeholder="12/26"
                          value={cardExpiry}
                          onChangeText={setCardExpiry}
                          maxLength={5}
                          keyboardType="number-pad"
                          placeholderTextColor="#9E9E9E"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.subFormLabel}>CVV</Text>
                        <TextInput
                          style={styles.subFormInput}
                          placeholder="•••"
                          value={cardCvv}
                          onChangeText={(v: string) => setCardCvv(v.replace(/[^0-9]/g, '').slice(0, 4))}
                          secureTextEntry
                          keyboardType="number-pad"
                          maxLength={4}
                          placeholderTextColor="#9E9E9E"
                        />
                      </View>
                    </View>
                    <Text style={styles.secureNote}>🔒 Your card details are encrypted & secure</Text>
                  </View>
                )}

                {/* Netbanking — bank picker */}
                {onlineMethod === 'netbanking' && (
                  <View style={styles.subForm}>
                    <Text style={styles.subFormLabel}>Select your bank</Text>
                    <View style={styles.banksGrid}>
                      {['HDFC', 'SBI', 'ICICI', 'Axis', 'Kotak', 'PNB', 'BOB', 'IDFC'].map(b => (
                        <TouchableOpacity
                          key={b}
                          style={[styles.bankChip, selectedBank === b && styles.bankChipActive]}
                          onPress={() => setSelectedBank(b)}
                        >
                          <Text style={[styles.bankChipText, selectedBank === b && { color: '#fff' }]}>{b}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {/* Wallets */}
                {onlineMethod === 'wallet' && (
                  <View style={styles.subForm}>
                    <Text style={styles.subFormLabel}>Choose your wallet</Text>
                    <View style={styles.banksGrid}>
                      {['Paytm', 'PhonePe', 'Amazon Pay', 'Mobikwik', 'Freecharge'].map(w => (
                        <TouchableOpacity
                          key={w}
                          style={[styles.bankChip, selectedWallet === w && styles.bankChipActive]}
                          onPress={() => setSelectedWallet(w)}
                        >
                          <Text style={[styles.bankChipText, selectedWallet === w && { color: '#fff' }]}>{w}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
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

            {/* Service Summary */}
            <View style={styles.summaryContainer}>
              <Text style={styles.summaryTitle}>📋 Service Summary</Text>
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
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Customer</Text>
                <Text style={styles.summaryValue}>{fullName || mobile}</Text>
              </View>
            </View>

            {/* Charge Breakdown */}
            <View style={styles.chargeContainer}>
              <Text style={styles.chargeTitle}>💰 Charge Breakdown</Text>
              <View style={styles.chargeRow}>
                <Text style={styles.chargeLabel}>Service Cost</Text>
                <Text style={styles.chargeValue}>₹{userCost}</Text>
              </View>
              <View style={styles.chargeRow}>
                <Text style={styles.chargeLabel}>Government Fees</Text>
                <Text style={styles.chargeValue}>₹{govtFees}</Text>
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
                onPress={() => navigation.navigate('MyBookings')}
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.serviceName}>{serviceData?.name || 'Service'}</Text>
        <Text style={styles.servicePrice}>₹{totalAmount}</Text>
      </View>

      {renderStepper()}

      <ScrollView style={styles.content}>
        {renderStep()}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 20 + insets.bottom }]}>
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

            {currentStep < 5 && (
              <TouchableOpacity
                style={styles.nextBtn}
                onPress={() => setCurrentStep(currentStep + 1)}
              >
                <Text style={styles.nextBtnText}>Next</Text>
              </TouchableOpacity>
            )}

            {currentStep === 5 && (
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={handleConfirmBooking}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.confirmBtnText}>Confirm Booking</Text>
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
          Replaces the free-text state input so domicile-style services get
          a clean, valid value every time. */}
      <Modal
        visible={showStatePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatePicker(false)}
      >
        <View style={styles.statePickerOverlay}>
          <View style={[styles.statePickerSheet, { paddingBottom: insets.bottom }]}>
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
              data={INDIAN_STATES.filter((s: string) =>
                s.toLowerCase().includes(stateSearch.trim().toLowerCase()),
              )}
              keyExtractor={(item: string) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }: any) => (
                <TouchableOpacity
                  style={styles.statePickerRow}
                  onPress={() => {
                    setState(item);
                    setStateSearch('');
                    setShowStatePicker(false);
                  }}
                >
                  <Text style={styles.statePickerRowText}>{item}</Text>
                  {state === item && <Text style={styles.statePickerCheck}>✓</Text>}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.statePickerEmpty}>No matching state.</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles: any = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    backgroundColor: '#E63946',
    padding: 20,
    paddingTop: 30,
  },
  serviceName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  servicePrice: {
    fontSize: 16,
    color: '#fff',
    marginTop: 5,
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
    paddingBottom: 16,
  },
  confirmImage: {
    width: '100%',
    height: 360,
    backgroundColor: '#0F172A',
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
    paddingBottom: 24,
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
  docPickerOptionIcon: {
    fontSize: 22,
    marginRight: 14,
  },
  docPickerOptionText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0D3B66',
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
    padding: 20,
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

  // ─── Modern stepper (compact, header + progress bar + dot row) ───
  modernStepperWrap: {
    backgroundColor: '#fff',
    margin: 12,
    borderRadius: 16,
    padding: 16,
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
    marginBottom: 12,
  },
  stepperHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepperHeaderIcon: { fontSize: 28, marginRight: 12 },
  stepperHeaderLabel: { fontSize: 10, fontWeight: '700', color: '#9E9E9E', letterSpacing: 1 },
  stepperHeaderTitle: { fontSize: 18, fontWeight: '800', color: '#1A1A1A', marginTop: 2 },
  stepperBadge: {
    backgroundColor: '#E63946',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  stepperBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  progressTrack: {
    height: 6,
    backgroundColor: '#F0F2F5',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#E63946',
    borderRadius: 3,
  },

  dotsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dotWrap: { alignItems: 'center', flex: 1 },
  dot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#F0F2F5',
    borderWidth: 2, borderColor: '#F0F2F5',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  dotCompleted: { backgroundColor: '#E63946', borderColor: '#E63946' },
  dotCurrent: { backgroundColor: '#fff', borderColor: '#E63946' },
  dotPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E63946' },
  dotCheck: { color: '#fff', fontSize: 12, fontWeight: '800' },
  dotLabel: { fontSize: 9, color: '#9E9E9E', fontWeight: '600' },
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
});

export default BookingScreen;
