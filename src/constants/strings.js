export const STRINGS = {
  APP_NAME: 'FliponeX',
  APP_TAGLINE: "India's #1 Doorstep Digital Service",

  // Hook — exact copy from the marketing brief
  HERO_HEADLINE: "India's #1 Doorstep Digital Service — At Your Home & Office!",
  HERO_SUBHEADLINE:
    'From Aadhaar updates to Industrial Licensing, access 100+ Government and Digital Services with one click. "Skip the Queues, Stay Online!" Choose FliponeX!',
  HERO_CTA_LINE: 'Safe* Secure* Reliable* Stop Waiting in Queues—Book FliponeX!',
  HERO_CTA_TAGLINE: 'Download App, Book Now, Pay Later (Highlights the trust factor).',
  HERO_CTA_BUTTON: 'Book Now, Pay Later',

  // Contact / Support (from FliponeX support desk)
  WHATSAPP_NUMBER: '+917482872330',
  WHATSAPP_URL: 'https://wa.me/917482872330',
  SUPPORT_EMAIL: 'support@fliponex.com',
  SUPPORT_PHONE: '+917482872330',
  SUPPORT_HOURS: 'Mon–Sat, 9:00 AM – 8:00 PM',
  CORPORATE_OFFICE: 'S. No.-11/1, Quepem, South Goa, Goa-403705',

  // Screen titles
  HOME: 'Home',
  PROFILE: 'Profile',
  SERVICE_DETAILS: 'Service Details',
  BOOKING: 'Book Service',

  // Service Type Toggle
  COMMON: 'Common',
  INDUSTRIAL: 'Industrial',

  // Service related
  SERVICES: 'Services',
  NO_SERVICES: 'No services available',
  LOADING_SERVICES: 'Loading services...',
  ESTIMATED_TIME: 'Estimated time',
  REQUIRED_DOCUMENTS: 'Required Documents',
  DESCRIPTION: 'Description',
  BOOK_NOW: 'Book Now',

  // Categories
  ALL_CATEGORIES: 'All Categories',

  // Support
  SUPPORT: 'Support',
  WHATSAPP_SUPPORT: 'WhatsApp Support',
  WHATSAPP_MESSAGE: 'Hi FliponeX, I need support',

  // Error messages
  ERROR_LOADING_SERVICES: 'Failed to load services. Please try again.',
  ERROR_LOADING_SERVICE_DETAILS: 'Failed to load service details. Please try again.',
  NETWORK_ERROR: 'Network error. Please check your connection.',

  // Empty states
  EMPTY_SERVICES_TITLE: 'No Services Found',
  EMPTY_SERVICES_SUBTITLE: "We couldn't find any services for this category.",
};

// ─── Why FliponeX — core value propositions shown on the home screen ───
export const VALUE_PROPS = [
  {
    icon: '🏠',
    title: 'Expert at Your Doorstep',
    subtitle: 'Certified professionals visit your home or office.',
  },
  {
    icon: '💸',
    title: 'Pay After Service',
    subtitle: 'Pay only once the task is successfully completed.',
  },
  {
    icon: '🔒',
    title: '100% Secure & Confidential',
    subtitle: 'Documents are encrypted and kept confidential.',
  },
  {
    icon: '📍',
    title: 'Real-time Tracking',
    subtitle: 'Monitor your application status live in the app.',
  },
];

// ─── Home hero promo carousel (banner concepts from marketing brief) ───
// Each item mirrors the PDF table: Banner Type · Main Text · Visual Suggestion.
// `visual` is displayed as a small caption line so designers/reviewers can see
// what imagery is intended for each slot.
// Tints restricted to the logo palette only:
//   Prussian Blue #0D3B66  · Light Red (action) #E63946
//   Gold #F5B301           · Light Yellow #FFF7D6    · White #FFFFFF
// `fg` is the text/emoji color that keeps AA contrast against the chosen tint.
export const HERO_BANNERS = [
  {
    bannerType: 'Consumer (B2C)',
    mainText: 'PAN, Aadhaar, or Voter ID? No more office visits!',
    visual: 'A happy family relaxing at home while a FliponeX expert works on a laptop nearby.',
    emoji: '👨‍👩‍👧',
    tint: '#0D3B66', // Prussian Blue
    fg: '#FFFFFF',
    badgeBg: '#F5B301',
    badgeFg: '#1A1A1A',
  },
  {
    bannerType: 'Industrial (B2B)',
    mainText: 'Industrial Licensing & GST? Focus on growth, we handle the files.',
    visual:
      "A factory owner shaking hands with a consultant — a clean office setup with a digital 'NOC Approved' stamp in the background.",
    emoji: '🏭',
    tint: '#F5B301', // Gold
    fg: '#0D3B66',
    badgeBg: '#0D3B66',
    badgeFg: '#FFFFFF',
  },
  {
    bannerType: 'Fast Track Service',
    mainText: '90-Minute Urgency Mode! For those urgent digital needs.',
    visual: 'A high-speed motion graphic with a countdown timer icon.',
    emoji: '⚡',
    tint: '#E63946', // Light red (action)
    fg: '#FFFFFF',
    badgeBg: '#FFF7D6',
    badgeFg: '#0D3B66',
  },
  {
    bannerType: 'Referral',
    mainText: 'Refer & Earn! Make your friends smart and earn rewards.',
    visual: "Glowing gift boxes and cash reward icons with a 'Share' button.",
    emoji: '🎁',
    tint: '#FFF7D6', // Light yellow
    fg: '#0D3B66',
    badgeBg: '#0D3B66',
    badgeFg: '#FFFFFF',
  },
];

// ─── Legal policy bodies (displayed in Profile → Support & Legal) ───
export const PRIVACY_POLICY = `FliponeX Digital respects your privacy.

• We use your documents solely for the requested service.
• Once the task is concluded, sensitive data is securely purged from our active systems.
• We never sell your data to third parties.`;

export const REFUND_POLICY = `Refund & Cancellation Policy

• Free Cancellation: Cancel your booking at no cost up to 1 hour before the scheduled slot.
• Visiting Fee: If the agent reaches the location and the service is cancelled by the user, a ₹99 visiting fee will apply.
• Refunds: If a service cannot be completed due to government portal technical errors or downtime, the service fee will be refunded (excluding the nominal visiting charge).`;

export const TERMS_CONDITIONS = `Terms & Conditions

• Customers must provide original and authentic documents for all applications.
• Submission of fraudulent documents will lead to immediate service termination.
• Service success is subject to Government portal availability.
• Payment is mandatory immediately upon job completion by the agent.
• All services are subject to government regulations.`;

// ─── In-App Help Center FAQ (from PDF Section 8) ───
export const FAQS = [
  {
    q: 'How do I verify my agent?',
    a: 'Every FliponeX agent carries a verified ID. You can cross-check the agent name and photo shown in your live booking details before handing over any documents.',
  },
  {
    q: 'Which payment modes are accepted?',
    a: 'UPI (Google Pay, PhonePe, Paytm), credit/debit cards, net banking and wallets. Cash-on-completion is also available for select services.',
  },
  {
    q: 'Is my payment secure?',
    a: 'Yes. Payments are processed via PCI-DSS compliant gateways. FliponeX never stores your card details on our servers.',
  },
  {
    q: 'Timeline for Aadhaar services?',
    a: 'Most Aadhaar updates are completed within 7–15 working days, subject to UIDAI portal availability.',
  },
  {
    q: 'Timeline for PAN services?',
    a: 'New PAN or correction requests are typically processed within 7–10 working days.',
  },
  {
    q: 'Timeline for Voter ID services?',
    a: 'Voter ID corrections and new applications generally take 15–30 working days, depending on local ERO processing.',
  },
  {
    q: 'Timeline for other services?',
    a: 'Most other services complete within 7–21 working days. Exact timelines are shown on each service details page.',
  },
];
