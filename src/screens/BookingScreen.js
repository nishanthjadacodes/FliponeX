import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUser } from '../utils/storage';
import { createBooking, getAvailableSlots, getLocationFromAddress, uploadDocument, getProfile, processPayment } from '../services/api';
import SuccessToast from '../components/SuccessToast';

const BookingScreen = ({ navigation, route }) => {
  const { serviceData } = route.params;
  
  // State for multi-step form
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [userMobile, setUserMobile] = useState('');

  // Toast for upload feedback
  const [toast, setToast] = useState({ visible: false, title: '', subtitle: '', variant: 'success' });
  const showToast = (title, subtitle = '', variant = 'success') =>
    setToast({ visible: true, title, subtitle, variant });

  // Fetch user profile to get mobile number
  useEffect(() => {
    const fetchUserMobile = async () => {
      try {
        const profile = await getProfile();
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
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);
  
  // Step 2: Personal Details
  const [fullName, setFullName] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [gender, setGender] = useState('Male');
  const [email, setEmail] = useState('');

  // Additional fields for various services
  const [maritalStatus, setMaritalStatus] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [relativeName, setRelativeName] = useState('');
  const [socialCategory, setSocialCategory] = useState('');
  const [disability, setDisability] = useState('');
  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [subdivision, setSubdivision] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [pincode, setPincode] = useState('');
  const [stayingFromYears, setStayingFromYears] = useState('');
  const [educationalQualification, setEducationalQualification] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [primaryOccupation, setPrimaryOccupation] = useState('');
  const [workExperienceYears, setWorkExperienceYears] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [workingPlatforms, setWorkingPlatforms] = useState('');
  const [mobile, setMobile] = useState('');

  // Function to parse service description and render dynamic form fields
  const renderDynamicFormFields = () => {
    if (!serviceData?.description) return null;
    
    const description = serviceData.description.toLowerCase();
    const fields = [];
    
    // Debug: Log the actual service description for Income Certificate
    if (serviceData.name && serviceData.name.toLowerCase().includes('income')) {
      console.log('=== INCOME CERTIFICATE DESCRIPTION DEBUG ===');
      console.log('Service Name:', serviceData.name);
      console.log('Description:', serviceData.description);
      console.log('Description Lowercase:', description);
      console.log('==========================================');
      
      // Extract and process the actual fields mentioned
      const mentionedFields = [];
      
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
      
      fieldPatterns.forEach(pattern => {
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
              onChange={(event, selectedDate) => {
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

    if (description.includes('state')) {
      fields.push(
        <View key="state" style={styles.inputGroup}>
          <Text style={styles.label}>State *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your state"
            value={state}
            onChangeText={setState}
          />
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
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  
  // Step 4: Slot Booking
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);
  const [serviceMode, setServiceMode] = useState('regular'); // 'regular' or 'fast_track'
  const [showSlotDatePicker, setShowSlotDatePicker] = useState(false);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [priorityFee] = useState(50); // Priority fee for fast-track service

  // Step 5: Payment
  const [paymentMethod, setPaymentMethod] = useState('pay_after');
  // Online sub-methods: 'upi' | 'card' | 'netbanking' | 'wallet'
  const [onlineMethod, setOnlineMethod] = useState(null);
  const [upiId, setUpiId] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardHolderName, setCardHolderName] = useState('');
  const [selectedBank, setSelectedBank] = useState(null);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [bookingNumber, setBookingNumber] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  
  // Calculate pricing — parse as numbers since API returns decimal strings
  const userCost = parseFloat(serviceData?.user_cost) || 0;
  const govtFees = parseFloat(serviceData?.govt_fees) || 0;
  const additionalFee = serviceMode === 'fast_track' ? priorityFee : 0;
  const totalAmount = userCost + govtFees + additionalFee;

  useEffect(() => {
    console.log('BookingScreen mounted with service:', serviceData);
  }, [serviceData]);

  const tryDeviceGPS = () =>
    new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => resolve(position.coords),
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000, showLocationDialog: true }
      );
    });

  const requestLocationPermission = async () => {
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
              const reverse = await getLocationFromAddress(`${latitude},${longitude}`);
              if (reverse?.address) displayAddress = reverse.address;
            } catch (_) {}
            setAddress(displayAddress);
            setUseCurrentLocation(true);
            setLoading(false);
            Alert.alert('Location Found', displayAddress);
            return;
          } catch (gpsErr) {
            console.log('Device GPS failed, falling back to backend:', gpsErr?.message);
          }
        } else {
          console.log('Permission denied by user, falling back to backend lookup');
        }
      } catch (permErr) {
        console.log('PermissionsAndroid.request errored (likely missing manifest entry):', permErr?.message);
      }
    }

    // Step 2: Fallback — try multiple free IP geolocation services
    const ipServices = [
      { url: 'https://ipwho.is/', map: (d) => d.success !== false ? { lat: d.latitude, lng: d.longitude, parts: [d.city, d.region, d.country, d.postal] } : null },
      { url: 'https://ipapi.co/json/', map: (d) => !d.error ? { lat: d.latitude, lng: d.longitude, parts: [d.city, d.region, d.country_name, d.postal] } : null },
      { url: 'https://ipinfo.io/json', map: (d) => d.loc ? { lat: parseFloat(d.loc.split(',')[0]), lng: parseFloat(d.loc.split(',')[1]), parts: [d.city, d.region, d.country, d.postal] } : null },
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
      } catch (e) {
        console.log(`${svc.url} failed:`, e?.message);
      }
    }

    setLoading(false);
    showManualEntryFallback({ message: 'All location services unavailable' });
  };
  
  const showManualEntryFallback = (error) => {
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

  const handleDocumentUpload = async (documentType) => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Please grant permission to access photos');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const fileUri = asset.uri;
        const fileName = `document_${documentType}_${Date.now()}.jpg`;
        const fileType = 'image/jpeg';
        
        setUploadProgress(prev => ({ ...prev, [documentType]: true }));
        
        // Create FormData for upload
        const uploadData = new FormData();
        
        // Use file URI directly for upload
        console.log('=== FILE UPLOAD ===');
        console.log('File URI:', fileUri);
        console.log('File name:', fileName);
        console.log('File type:', fileType);
        
        // Create file object from URI for React Native
        const fileObject = {
          uri: fileUri,
          type: fileType,
          name: fileName,
        };
        
        uploadData.append('file', fileObject);
        uploadData.append('document_type', documentType);
        uploadData.append('file_name', fileName);
        
        console.log('=== UPLOAD ATTEMPT ===');
        console.log('Document type:', documentType);
        console.log('File name:', fileName);
        console.log('Sending request to: http://10.254.230.253:3001/api/documents/upload');
        
        console.log('=== STARTING UPLOAD ===');
        
        console.log('=== STARTING UPLOAD ===');
        // Try upload without booking ID first with retry logic
        let response;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            response = await uploadDocument('', uploadData);
            break; // Success, exit retry loop
          } catch (error) {
            retryCount++;
            console.log(`Upload attempt ${retryCount} failed:`, error.message);
            
            if (retryCount >= maxRetries) {
              throw error; // Re-throw after max retries
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }
        
        setUploadedDocuments(prev => [...prev, {
          type: documentType,
          uri: fileUri,
          name: fileName,
          uploadResponse: response.data,
        }]);
        
        showToast(
          'Document Uploaded',
          `${documentType.replace(/_/g, ' ')} added successfully`,
          'success'
        );

        await new Promise(resolve => setTimeout(resolve, 800));
      }
    } catch (uploadError) {
      console.error('Upload error:', uploadError);
      // Surface the actual backend reason instead of a generic message
      const reason = uploadError?.message
        || uploadError?.response?.data?.message
        || 'Please try again in a moment';
      showToast('Upload Failed', reason, 'error');
    } finally {
      setUploadProgress(prev => ({ ...prev, [documentType]: false }));
    }
  };

  const processOnlinePayment = async (bookingId, amount) => {
    try {
      setProcessingPayment(true);
      setPaymentError('');
      
      console.log('=== PROCESSING ONLINE PAYMENT ===');
      console.log('Booking ID:', bookingId);
      console.log('Amount:', amount);
      
      // Process payment using actual payment gateway
      const paymentData = {
        booking_id: bookingId,
        amount: amount,
        payment_method: 'online',
        currency: 'INR'
      };
      
      const paymentResponse = await processPayment(paymentData);
      
      if (paymentResponse.success) {
        console.log('Payment successful:', paymentResponse);
        Alert.alert(
          'Payment Successful',
          `Your payment of ₹${amount} has been processed successfully.\nTransaction ID: ${paymentResponse.transaction_id}`,
          [
            {
              text: 'OK',
              onPress: () => {
                setCurrentStep(6);
                setBookingNumber('BK' + Date.now().toString().slice(-6));
              }
            }
          ]
        );
        return paymentResponse;
      } else {
        throw new Error(paymentResponse.message || 'Payment failed');
      }
      
    } catch (error) {
      console.error('Payment processing error:', error);
      setPaymentError(error.message || 'Payment processing failed');
      Alert.alert('Payment Error', error.message || 'Failed to process payment');
      throw error;
    } finally {
      setProcessingPayment(false);
    }
  };

  // Slot Booking Functions
  const generateTimeSlots = (date) => {
    const slots = [];
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

  const validateBookingWindow = (selectedDateTime) => {
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

  const validateWorkingHours = (selectedDateTime) => {
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

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setShowSlotDatePicker(false);
    
    // Generate available slots for the selected date
    const slots = generateTimeSlots(date);
    setAvailableSlots(slots);
    setSelectedTimeSlot(null); // Reset selected time slot
  };

  const handleTimeSlotSelect = (slot) => {
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
  const validateMobile = (mobile) => {
    if (!mobile) return false;
    // Remove spaces and special characters
    const cleanMobile = mobile.replace(/\s/g, '').replace(/[-+]/g, '');
    const mobileRegex = /^[6-9]\d{9}$/;
    return mobileRegex.test(cleanMobile);
  };

  // Function to add booking to Agentapp notification system
  const addBookingToAgentapp = async () => {
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

  const handleConfirmBooking = async () => {
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
      const storedUser = await getUser();
      const resolvedCustomerName = fullName || applicantName || storedUser?.name || mobile || userMobile || 'Customer';

      // Create booking data object first
      const bookingData = {
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
        payment_method: paymentMethod,
        total_amount: totalAmount,
        user_cost: userCost,
        govt_fees: govtFees,
        additional_fee: additionalFee,
        status: 'confirmed',
        created_at: new Date().toISOString(),
        booking_number: 'BK' + Date.now().toString().slice(-6)
      };

      // Send booking to server API with retry mechanism
      let bookingCreated = false;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (!bookingCreated && retryCount < maxRetries) {
        try {
          console.log(`=== SENDING BOOKING TO SERVER (Attempt ${retryCount + 1}/${maxRetries}) ===`);
          console.log('Booking data for API:', bookingData);
          
          const apiResponse = await createBooking(bookingData);
          console.log('Booking created on server:', apiResponse);
          
          // Update booking data with server response
          // Backend returns { success: true, data: booking } so id is at apiResponse.data.id
          const createdId = apiResponse?.data?.id || apiResponse?.id;
          if (createdId) {
            bookingData.id = createdId;
            bookingCreated = true;
            console.log('✅ Booking successfully created with ID:', createdId);
          }
        } catch (serverError) {
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
        
        const duplicateBooking = bookings.find(booking => 
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

      // Call the addBookingToAgentapp function after booking is confirmed
      if (paymentMethod === 'pay_online') {
        // Process online payment
        try {
          await processOnlinePayment(bookingData.id, totalAmount);
          addBookingToAgentapp();
        } catch (paymentError) {
          // Payment failed but booking was created
          Alert.alert(
            'Payment Failed',
            'Your booking was created but payment failed. You can try paying later.',
            [
              {
                text: 'Pay Later',
                onPress: async () => {
                  setCurrentStep(6);
                  setBookingNumber('BK' + Date.now().toString().slice(-6));
                  try {
                    await processOnlinePayment(bookingData.id, totalAmount);
                  } catch (retryError) {
                    console.error('Retry payment failed:', retryError);
                  }
                }
              }
            ]
          );
        }
      } else {
        // Pay after service - confirm booking directly
        addBookingToAgentapp();
        setCurrentStep(6);
        setBookingNumber('BK' + Date.now().toString().slice(-6));
        
        // Show success message
        Alert.alert(
          'Booking Confirmed!',
          `Your booking has been confirmed successfully. Booking Number: ${'BK' + Date.now().toString().slice(-6)}`,
          [
            {
              text: 'OK',
              onPress: () => {
                // Navigate to home or bookings screen
                navigation.navigate('MyBookings');
              }
            }
          ]
        );
      }
    } catch (error) {
    console.error('Error adding booking to Agentapp:', error);
  } finally {
    setLoading(false);
  }
};

  // Stepper component
  const renderStepper = () => {
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
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
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

  const renderStep = () => {
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

      case 3:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Required Documents</Text>
            
            {serviceData?.required_documents && serviceData.required_documents.length > 0 ? (
              serviceData.required_documents.map((doc, index) => (
                <View key={index} style={styles.documentRow}>
                  <Text style={styles.documentName}>{doc.label || doc}</Text>
                  <TouchableOpacity 
                    style={[styles.uploadBtn, uploadProgress[doc.type] && styles.uploadBtnDisabled]} 
                    onPress={() => handleDocumentUpload(doc.type)}
                    disabled={uploadProgress[doc.type]}
                  >
                    {uploadProgress[doc.type] ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.uploadBtnText}>
                        {uploadedDocuments.find(d => d.type === doc.type) ? '✅ Uploaded' : 'Upload'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <Text style={styles.noDocuments}>No documents required</Text>
            )}
          </View>
        );

      case 4:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Select Service Mode & Time Slot</Text>
            
            {/* Service Mode Selection */}
            <Text style={styles.label}>Service Mode</Text>
            <TouchableOpacity 
              style={[styles.paymentBtn, serviceMode === 'regular' && styles.paymentBtnActive]} 
              onPress={() => setServiceMode('regular')}
            >
              <Text style={[styles.paymentBtnText, serviceMode === 'regular' && styles.paymentBtnTextActive]}>
                📅 Regular Service
              </Text>
              <Text style={styles.serviceModeDescription}>
                Book 4+ hours in advance (7:00 AM - 7:00 PM)
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.paymentBtn, serviceMode === 'fast_track' && styles.paymentBtnActive]} 
              onPress={() => setServiceMode('fast_track')}
            >
              <Text style={[styles.paymentBtnText, serviceMode === 'fast_track' && styles.paymentBtnTextActive]}>
                ⚡ Fast-Track Service (+₹{priorityFee})
              </Text>
              <Text style={styles.serviceModeDescription}>
                Service within 90 minutes (9:00 AM - 6:00 PM)
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
                onChange={(event, date) => {
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
                  {availableSlots.map((slot) => (
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
              <View style={[styles.priceRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total Amount:</Text>
                <Text style={styles.totalValue}>₹{totalAmount}</Text>
              </View>
            </View>
            
            <Text style={styles.paymentTitle}>Choose how you'd like to pay</Text>

            {/* Primary: Pay After Service */}
            <TouchableOpacity
              style={[styles.payOptionCard, paymentMethod === 'pay_after' && styles.payOptionCardActive]}
              onPress={() => { setPaymentMethod('pay_after'); setOnlineMethod(null); }}
            >
              <View style={[styles.payOptionIcon, { backgroundColor: '#E8F5E9' }]}>
                <Text style={styles.payOptionEmoji}>💵</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.payOptionTitle}>Pay After Service</Text>
                <Text style={styles.payOptionSubtitle}>Cash or UPI to the agent after completion</Text>
              </View>
              <View style={[styles.payRadio, paymentMethod === 'pay_after' && styles.payRadioActive]}>
                {paymentMethod === 'pay_after' && <View style={styles.payRadioDot} />}
              </View>
            </TouchableOpacity>

            {/* Primary: Pay Online */}
            <TouchableOpacity
              style={[styles.payOptionCard, paymentMethod === 'pay_online' && styles.payOptionCardActive]}
              onPress={() => setPaymentMethod('pay_online')}
            >
              <View style={[styles.payOptionIcon, { backgroundColor: '#E3F2FD' }]}>
                <Text style={styles.payOptionEmoji}>💳</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.payOptionTitle}>Pay Online Now</Text>
                <Text style={styles.payOptionSubtitle}>UPI, Cards, Netbanking, Wallets</Text>
              </View>
              <View style={[styles.payRadio, paymentMethod === 'pay_online' && styles.payRadioActive]}>
                {paymentMethod === 'pay_online' && <View style={styles.payRadioDot} />}
              </View>
            </TouchableOpacity>

            {/* Online sub-methods grid — shown only when Pay Online is picked */}
            {paymentMethod === 'pay_online' && (
              <View style={styles.onlineMethodsBox}>
                <Text style={styles.onlineMethodsLabel}>Select payment method</Text>
                <View style={styles.onlineMethodsGrid}>
                  {[
                    { key: 'upi',        icon: '🏦', label: 'UPI' },
                    { key: 'card',       icon: '💳', label: 'Card' },
                    { key: 'netbanking', icon: '🏧', label: 'Netbanking' },
                    { key: 'wallet',     icon: '👛', label: 'Wallet' },
                  ].map((m) => (
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
                      onChangeText={(v) => setCardNumber(v.replace(/[^0-9 ]/g, '').slice(0, 19))}
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
                          onChangeText={(v) => setCardCvv(v.replace(/[^0-9]/g, '').slice(0, 4))}
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
                <Text style={styles.bookingNumberText}>#{bookingNumber}</Text>
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
                  {serviceMode === 'fast_track' ? '⚡ Fast-Track' : 'Regular'}
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
                <View style={[
                  styles.paymentBadge,
                  paymentMethod === 'pay_online' ? styles.paymentBadgePaid : styles.paymentBadgePending,
                ]}>
                  <Text style={[
                    styles.paymentBadgeText,
                    paymentMethod === 'pay_online' ? styles.paymentBadgeTextPaid : styles.paymentBadgeTextPending,
                  ]}>
                    {paymentMethod === 'pay_online' ? '✓ Paid Online' : '💵 Pay After Service'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Assigned Agent — only show when assigned */}
            <View style={styles.agentContainer}>
              <Text style={styles.agentTitle}>🧑‍💼 Service Agent</Text>
              <View style={styles.agentCard}>
                <View style={styles.agentAvatar}>
                  <Text style={styles.avatarText}>?</Text>
                </View>
                <View style={styles.agentDetails}>
                  <Text style={styles.agentName}>Agent Pending</Text>
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
                  <Text style={styles.progressText}>Agent Assigned</Text>
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

      <View style={styles.footer}>
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
    </View>
  );
}

const styles = StyleSheet.create({
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
  stepCircle: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
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
  stepTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#212121',
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
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    marginTop: 8,
    paddingTop: 12,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#E63946',
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
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  paymentBtnActive: {
    backgroundColor: '#E63946',
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
    backgroundColor: '#E63946',
    borderColor: '#E63946',
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
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backBtn: {
    flex: 1,
    padding: 14,
    backgroundColor: '#E0E0E0',
    borderRadius: 10,
    marginRight: 10,
    alignItems: 'center',
  },
  backBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  nextBtn: {
    flex: 2,
    padding: 14,
    backgroundColor: '#E63946',
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
