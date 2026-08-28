import type { Metadata } from "next";

import {
  LegalBullets,
  LegalIntro,
  LegalPageLayout,
  LegalSection,
} from "@/components/legal/LegalPageLayout";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

/*
 * Full text of the DACS Privacy Policy, transcribed verbatim from the
 * client PDF (NGR_Privacy_Policy.pdf) — wording, numbering, bullets and
 * bold emphasis preserved. This page is the canonical copy for the whole
 * system; the admin app links here rather than hosting its own version.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy">
      <LegalIntro>
        <p>
          National Group Research (NGR) (“NGR,” “we,” “our,” or “us”), as the
          developers of the Digital Agriculture Collaboration and Support
          System (DACS), is committed to protecting personal information
          processed through the platform.
        </p>
        <p>
          DACS was developed by NGR for Dominant Asia Poultry Genetics to
          support its operational and customer-service processes, including
          customer and farm information management, orders and payments,
          seminars, breeder certification monitoring, inquiries, historical
          records, and reporting.
        </p>
        <p>
          This Privacy Policy explains how personal information may be
          collected, processed, stored, accessed, used, and protected through
          DACS. It also distinguishes the responsibilities of NGR as the
          developer and administrator of the DACS platform from the
          organizational responsibilities of Dominant Asia Poultry Genetics as
          the provider of the products, seminars, certification activities,
          customer services, and other business processes supported through
          the system.
        </p>
        <p>
          Personal information submitted through DACS may be processed for
          purposes connected with the services and operations of Dominant Asia
          Poultry Genetics and for the technical operation, maintenance,
          security, and administration of the DACS platform.
        </p>
        <p>
          By accessing or using DACS, you acknowledge that you have been
          informed of the practices described in this Privacy Policy.
        </p>
      </LegalIntro>

      <LegalSection heading="1. Information We Collect">
        <p>
          Depending on the DACS services you use, we may collect information
          including:
        </p>
        <LegalBullets
          items={[
            "Full name;",
            "Email address;",
            "Contact number;",
            "Address and location;",
            "Account and user-role information;",
            "Profile image;",
            "Farm name, address, and farm-related information;",
            "Order and transaction details;",
            "Payment records and uploaded proof of payment;",
            "Seminar registration and participation records;",
            "Seminar progress, quiz results, and completion records;",
            "Certificate requests;",
            "Breeder eligibility and certification information;",
            "Parent Stock transaction and release information;",
            "Inquiry tickets and ticket status;",
            "Uploaded files and documents;",
            "Historical transaction records;",
            "Notification preferences; and",
            "System activity and audit-log information.",
          ]}
        />
        <p>
          We only intend to collect information reasonably necessary for DACS
          and the services provided by Dominant Asia Poultry Genetics.
        </p>
      </LegalSection>

      <LegalSection heading="2. How We Collect Information">
        <p>Information may be collected when you:</p>
        <LegalBullets
          items={[
            "Create or update a DACS account;",
            "Complete your customer or farm profile;",
            "Register for or participate in seminars;",
            "Place an order;",
            "Upload proof of payment;",
            "Request a certificate;",
            "Submit an inquiry ticket;",
            "Upload documents or images; or",
            "Otherwise use DACS services.",
          ]}
        />
        <p>
          Authorized Dominant Asia personnel may also create, verify, correct,
          or update records when necessary.
        </p>
        <p>
          DACS may contain historical information previously collected through
          authorized organizational records, including Google Forms and Google
          Sheets.
        </p>
        <p>
          Certain technical information may also be generated automatically
          when you use the system, such as activity dates, timestamps, account
          actions, and system logs.
        </p>
      </LegalSection>

      <LegalSection heading="3. How We Use Your Information">
        <p>Personal information processed through DACS may be used to:</p>
        <LegalBullets
          items={[
            "Create and manage user accounts;",
            "Authenticate users;",
            "Maintain customer and farm profiles;",
            "Process and monitor orders;",
            "Record and verify payments;",
            "Manage seminar registration and participation;",
            "Track seminar progress and quiz results;",
            "Process seminar certificate requests;",
            "Determine Parent Stock ordering eligibility;",
            "Monitor breeder eligibility and certification;",
            "Maintain breeder certification records;",
            "Receive and manage inquiry tickets;",
            "Send or support responses to inquiries;",
            "Maintain transaction histories;",
            "Consolidate historical records;",
            "Generate operational reports and dashboards;",
            "Provide system notifications;",
            "Protect the security of DACS; and",
            "Maintain reliable operational records.",
          ]}
        />
        <p>
          Information will not be intentionally used for purposes unrelated to
          the operation of DACS without an appropriate lawful basis.
        </p>
      </LegalSection>

      <LegalSection heading="4. Seminar and Breeder Information">
        <p>
          DACS may use seminar and transaction records to apply the business
          rules of Dominant Asia Poultry Genetics.
        </p>
        <p>
          For example, DACS may verify whether{" "}
          <strong>Seminar Modules 1, 2, and 3</strong> have been completed
          before allowing a Client/Farmer to place a Parent Stock order.
        </p>
        <p>
          For breeder monitoring, DACS may use the released date of a
          qualifying Parent Stock transaction to monitor the applicable{" "}
          <strong>90-day breeder eligibility period</strong>.
        </p>
        <p>
          Breeder certification records may also include certification dates,
          validity periods, expiration dates, and statuses such as:
        </p>
        <LegalBullets
          items={["Active;", "Pending;", "Expired; and", "Ineligible."]}
        />
        <p>
          The current DACS requirements provide for breeder certifications to
          be monitored using a <strong>two-year validity period</strong>,
          subject to verification and the applicable policies of Dominant Asia
          Poultry Genetics.
        </p>
      </LegalSection>

      <LegalSection heading="5. Payment Information">
        <p>DACS allows users to upload proof of payment for verification.</p>
        <p>
          Under the current design, DACS does not automatically process
          real-time electronic payments.
        </p>
        <p>
          Uploaded payment records may be reviewed by authorized
          Administrative Staff and linked to the appropriate order.
        </p>
        <p>
          Users should avoid including unnecessary personal or financial
          information in uploaded payment documents.
        </p>
      </LegalSection>

      <LegalSection heading="6. Inquiry Information">
        <p>When you submit an inquiry through DACS, the system may record:</p>
        <LegalBullets
          items={[
            "Your identity;",
            "Ticket number;",
            "Inquiry category;",
            "Inquiry details;",
            "Assigned personnel;",
            "Submission date;",
            "Ticket status; and",
            "Other information necessary to manage the inquiry.",
          ]}
        />
        <p>DACS primarily records and monitors inquiry tickets.</p>
        <p>
          Actual responses and resolutions may be communicated through the
          official email channel of Dominant Asia Poultry Genetics.
        </p>
      </LegalSection>

      <LegalSection heading="7. Sharing and Access to Information">
        <p>
          Dominant Asia does{" "}
          <strong>
            not intend to sell personal information collected through DACS
          </strong>
          .
        </p>
        <p>
          Personal information may only be accessed or shared when reasonably
          necessary.
        </p>
        <p>Access may be provided to authorized:</p>
        <LegalBullets
          items={[
            "Owner/Executive users;",
            "IT Staff;",
            "Administrative Staff; and",
            "Other personnel with appropriate authorization.",
          ]}
        />
        <p>
          DACS uses Role-Based Access Control so users can only access
          information and system functions appropriate to their assigned role.
        </p>
        <p>
          Information may also be processed by technology providers necessary
          for the operation of DACS, such as authentication, hosting,
          database, storage, backup, security, or email-service providers.
        </p>
        <p>
          Information may also be disclosed where required or permitted by
          applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="8. Third-Party Services">
        <p>
          DACS may rely on third-party services to operate certain system
          functions.
        </p>
        <p>The current system design includes:</p>
        <LegalBullets
          items={[
            <>
              <strong>Firebase Authentication</strong> for user
              authentication; and
            </>,
            <>
              A{" "}
              <strong>
                PostgreSQL database using Alibaba Cloud infrastructure
              </strong>{" "}
              for centralized operational data.
            </>,
          ]}
        />
        <p>
          Other technical services may be introduced where necessary for
          system operation, maintenance, backups, email communication, or
          security.
        </p>
        <p>
          Where third-party service providers process information for DACS,
          reasonable measures should be taken to protect personal information
          and restrict its use to authorized purposes.
        </p>
      </LegalSection>

      <LegalSection heading="9. Data Security">
        <p>
          Dominant Asia and the administrators of DACS will implement
          reasonable safeguards designed to protect information against:
        </p>
        <LegalBullets
          items={[
            "Unauthorized access;",
            "Unauthorized disclosure;",
            "Improper modification;",
            "Accidental loss;",
            "Fraud;",
            "Misuse; and",
            "Other security threats.",
          ]}
        />
        <p>Security measures may include:</p>
        <LegalBullets
          items={[
            "User authentication;",
            "Role-Based Access Control;",
            "Restricted database access;",
            "Input and file validation;",
            "Activity and audit logs;",
            "Backup and recovery procedures; and",
            "System monitoring and maintenance.",
          ]}
        />
        <p>
          However, no internet-based system can guarantee absolute security.
        </p>
        <p>
          Users are also responsible for protecting access to their own
          accounts and devices.
        </p>
      </LegalSection>

      <LegalSection heading="10. Data Retention">
        <p>
          Personal and operational information will be retained only for as
          long as reasonably necessary for:
        </p>
        <LegalBullets
          items={[
            "Providing DACS services;",
            "Maintaining customer and transaction histories;",
            "Completing orders;",
            "Verifying payments;",
            "Maintaining seminar and certification records;",
            "Managing inquiries;",
            "Security and audit requirements;",
            "Organizational recordkeeping; and",
            "Compliance with applicable legal requirements.",
          ]}
        />
        <p>
          When information is no longer reasonably required and there is no
          lawful reason for continued retention, it may be deleted,
          anonymized, archived, or securely disposed of according to
          applicable organizational procedures.
        </p>
      </LegalSection>

      <LegalSection heading="11. Accuracy and Correction of Information">
        <p>
          Users are responsible for providing accurate and current
          information.
        </p>
        <p>Certain profile details may be updated directly through DACS.</p>
        <p>
          Some official records, including transactions, payments,
          certifications, seminar records, and historical information, may
          require verification by authorized staff before they can be
          changed.
        </p>
        <p>
          If you believe information associated with your account is
          incorrect, you may request its review or correction.
        </p>
      </LegalSection>

      <LegalSection heading="12. Your Privacy Rights">
        <p>
          Subject to applicable Philippine data privacy laws and lawful
          limitations, you may have rights concerning your personal
          information, including the right to:
        </p>
        <LegalBullets
          items={[
            "Be informed about how your information is processed;",
            "Request access to personal information relating to you;",
            "Object to certain processing where applicable;",
            "Request correction of inaccurate information;",
            "Request blocking, deletion, or removal where legally appropriate;",
            "Exercise applicable data-portability rights; and",
            "Raise a concern or complaint regarding the processing of your personal information.",
          ]}
        />
        <p>
          Requests may require identity verification before information is
          disclosed or modified.
        </p>
      </LegalSection>

      <LegalSection heading="13. Cookies and Technical Information">
        <p>
          DACS may use cookies, authentication tokens, browser storage, or
          similar technologies where necessary to:
        </p>
        <LegalBullets
          items={[
            "Keep users signed in;",
            "Maintain secure sessions;",
            "Remember essential system preferences;",
            "Protect user accounts; and",
            "Enable normal DACS functionality.",
          ]}
        />
        <p>
          If optional analytics, advertising, or other non-essential tracking
          technologies are introduced in the future, appropriate disclosures
          and user choices should be provided where required.
        </p>
      </LegalSection>

      <LegalSection heading="14. System Activity and Audit Logs">
        <p>
          DACS may record certain user and administrative activities for
          security, troubleshooting, system maintenance, and accountability.
        </p>
        <p>Audit records may include information such as:</p>
        <LegalBullets
          items={[
            "Date and time;",
            "User;",
            "User role;",
            "Module accessed;",
            "Action performed;",
            "Status; and",
            "Description of the activity.",
          ]}
        />
        <p>
          Access to audit logs is limited to authorized personnel based on
          their assigned permissions.
        </p>
      </LegalSection>

      <LegalSection heading="15. Data Privacy and Philippine Law">
        <p>
          The collection, processing, storage, and use of personal
          information through DACS will be handled in accordance with
          applicable Philippine privacy requirements, including the{" "}
          <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>{" "}
          and other applicable privacy and security requirements.
        </p>
        <p>
          Dominant Asia Poultry Genetics will take reasonable steps to ensure
          that personal information is processed for legitimate and
          appropriate purposes.
        </p>
      </LegalSection>

      <LegalSection heading="16. Changes to This Privacy Policy">
        <p>This Privacy Policy may be updated when necessary because of:</p>
        <LegalBullets
          items={[
            "Changes to DACS functionality;",
            "Changes in organizational procedures;",
            "New system features;",
            "Changes in service providers;",
            "Security requirements; or",
            "Applicable legal or regulatory requirements.",
          ]}
        />
        <p>
          The most recent version will display its{" "}
          <strong>Last Updated</strong> date.
        </p>
        <p>
          Where significant changes materially affect how personal
          information is handled, reasonable notice may be provided through
          DACS, email, or another appropriate method.
        </p>
      </LegalSection>

      <LegalSection heading="17. Contact Information">
        <p>
          For questions, concerns, correction requests, or other
          privacy-related matters, contact:
        </p>
        <p className="text-start">
          <strong>Dominant Asia Poultry Genetics</strong>
          <br />
          <strong>Privacy / Data Protection Contact:</strong> [Insert Name or
          Position]
          <br />
          <strong>Email:</strong> [Official Privacy Email]
          <br />
          <strong>Contact Number:</strong> [Contact Number]
          <br />
          <strong>Business Address:</strong> [Business Address]
        </p>
      </LegalSection>

      <LegalSection heading="Privacy Acknowledgment">
        <p>
          By using DACS after being provided with this Privacy Policy, you
          acknowledge that you have been informed about how personal
          information may be collected, used, stored, shared, and protected
          through the system.
        </p>
        <p>
          Where a particular activity requires your consent, DACS may request
          that consent separately.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
