import type { Metadata } from "next";

import {
  LegalBullets,
  LegalIntro,
  LegalPageLayout,
  LegalSection,
} from "@/components/legal/LegalPageLayout";

export const metadata: Metadata = {
  title: "Terms and Conditions",
};

/*
 * Full text of the DACS Terms and Conditions, transcribed verbatim from
 * the client PDF (NGR_Terms_and_Conditions.pdf) — wording, numbering,
 * bullets and bold emphasis preserved. This page is the canonical copy for
 * the whole system; the admin app links here rather than hosting its own
 * version.
 */
export default function TermsAndConditionsPage() {
  return (
    <LegalPageLayout title="Terms and Conditions">
      <LegalIntro>
        <p>
          Welcome to the Digital Agriculture Collaboration and Support System
          (DACS).
        </p>
        <p>
          These Terms and Conditions (“Terms”) are established by National
          Group Research (NGR), the developers of the Digital Agriculture
          Collaboration and Support System (DACS), and govern your access to
          and use of the DACS platform.
        </p>
        <p>
          DACS was developed by NGR to support the operational processes and
          services of Dominant Asia Poultry Genetics, including customer
          information management, orders and payment recording, seminar
          management, breeder certification monitoring, inquiry management,
          historical records, and operational reporting.
        </p>
        <p>
          While NGR establishes the conditions governing access to and use of
          the DACS platform, the products, payments, seminars, breeder
          certification, eligibility requirements, order approvals, customer
          services, and other organizational activities made available
          through DACS remain subject to the applicable policies, procedures,
          verification, and approval of Dominant Asia Poultry Genetics.
        </p>
        <p>
          By creating an account, accessing DACS, submitting information,
          placing an order, registering for or participating in seminars,
          uploading files, submitting an inquiry, or otherwise using the
          platform, you acknowledge that you have read, understood, and
          agreed to these Terms.
        </p>
        <p>
          If you do not agree with these Terms, you should not access or use
          DACS.
        </p>
      </LegalIntro>

      <LegalSection heading="1. About DACS">
        <p>
          DACS is a web-based and mobile-accessible information system
          developed to support the services and operational processes of
          Dominant Asia Poultry Genetics.
        </p>
        <p>
          Depending on the user’s account, role, permissions, and
          eligibility, DACS may provide access to features including:
        </p>
        <LegalBullets
          items={[
            "Account registration and authentication;",
            "Customer and farm profile management;",
            "Parent Stock, F1 product, and veterinary product ordering;",
            "Submission of proof of payment;",
            "Order and payment status tracking;",
            "Seminar registration and participation;",
            "Seminar modules, learning materials, quizzes, and progress tracking;",
            "Seminar certificate requests;",
            "Breeder eligibility and certification monitoring;",
            "Inquiry ticket submission and status tracking;",
            "Frequently Asked Questions (FAQ) Knowledge Base;",
            "Transaction and historical records;",
            "Notifications;",
            "Operational dashboards and reports; and",
            "Administrative and account-management functions.",
          ]}
        />
        <p>
          Some functions are available only to authorized Dominant Asia
          personnel and may depend on the user’s assigned role.
        </p>
      </LegalSection>

      <LegalSection heading="2. User Accounts">
        <p>Certain DACS services require a registered account.</p>
        <p>You agree to:</p>
        <LegalBullets
          items={[
            "Provide accurate, complete, and current information;",
            "Maintain the accuracy of your account and profile information;",
            "Use only an account that belongs to you or that you are authorized to use;",
            "Protect your account and authentication credentials from unauthorized access;",
            "Not allow another person to impersonate you through your account; and",
            "Notify Dominant Asia if you become aware of unauthorized access to your account.",
          ]}
        />
        <p>
          You are responsible for activities performed through your account
          to the extent permitted by applicable law.
        </p>
        <p>
          DACS may use third-party authentication services to authenticate
          and secure user access.
        </p>
        <p>
          Account access may depend on the role assigned to the user,
          including roles such as{" "}
          <strong>
            Owner/Executive, IT Staff, Administrative Staff, and
            Client/Farmer
          </strong>
          .
        </p>
        <p>
          Users may only access information and functions authorized for
          their assigned role.
        </p>
      </LegalSection>

      <LegalSection heading="3. Customer and Farm Information">
        <p>
          Clients and farmers may be required to provide personal, contact,
          farm, transaction, and other relevant information for the use of
          DACS services.
        </p>
        <p>
          Information submitted must be accurate and must not intentionally
          contain false, misleading, fraudulent, or unauthorized information.
        </p>
        <p>
          DACS may reuse information already associated with a user’s account
          in order to reduce repeated data entry across services such as
          seminar registration, orders, payments, inquiries, and breeder
          certification.
        </p>
        <p>
          Users should review their information periodically and report
          incorrect information that they are unable to correct themselves.
        </p>
        <p>
          Certain records may only be modified by authorized Dominant Asia
          personnel when necessary to maintain the accuracy and integrity of
          official operational records.
        </p>
      </LegalSection>

      <LegalSection heading="4. Orders">
        <p>
          Registered Clients/Farmers may use DACS to submit orders for
          products offered by Dominant Asia Poultry Genetics, which may
          include:
        </p>
        <LegalBullets
          items={[
            "Parent Stocks;",
            "F1 products;",
            "Veterinary products; and",
            "Other products or services that Dominant Asia may make available through DACS.",
          ]}
        />
        <p>
          Submitting an order through DACS does not automatically guarantee
          product availability, acceptance, release, or fulfillment.
        </p>
        <p>
          An order may remain subject to verification, availability,
          organizational requirements, payment verification, and other
          applicable Dominant Asia procedures.
        </p>
        <p>DACS may display statuses such as:</p>
        <LegalBullets
          items={[
            "Pending;",
            "Payment Submitted;",
            "Payment Verified;",
            "Processing;",
            "Fulfilled; or",
            "Other statuses established by Dominant Asia.",
          ]}
        />
        <p>
          Users are responsible for reviewing the status and information
          associated with their orders.
        </p>
      </LegalSection>

      <LegalSection heading="5. Parent Stock Ordering Requirements">
        <p>
          Parent Stock orders are subject to the eligibility requirements
          established by Dominant Asia Poultry Genetics.
        </p>
        <p>
          Where required by the organization’s policies, a Client/Farmer must
          complete the required <strong>Seminar Modules 1, 2, and 3</strong>{" "}
          before DACS enables Parent Stock ordering.
        </p>
        <p>
          Completion of the seminar requirements allows the user to proceed
          with the applicable ordering process but does not by itself
          guarantee acceptance, availability, payment approval, release, or
          fulfillment of a Parent Stock order.
        </p>
        <p>
          Users must not attempt to bypass, manipulate, or interfere with
          seminar prerequisites or other eligibility controls implemented by
          DACS.
        </p>
      </LegalSection>

      <LegalSection heading="6. Payments and Proof of Payment">
        <p>
          DACS does{" "}
          <strong>not automatically process electronic payments</strong>{" "}
          unless Dominant Asia introduces such functionality in the future.
        </p>
        <p>
          Users may upload proof of payment through DACS for applicable
          transactions.
        </p>
        <p>
          Submission of proof of payment does not mean that payment has
          automatically been verified or accepted.
        </p>
        <p>
          Authorized Dominant Asia personnel will review submitted proof of
          payment and may approve, reject, or request clarification regarding
          the submission.
        </p>
        <p>Users must not upload:</p>
        <LegalBullets
          items={[
            "Fabricated or altered payment documents;",
            "Proof of payment belonging to an unrelated transaction;",
            "Files containing malicious software;",
            "Documents obtained unlawfully; or",
            "Information they are not authorized to disclose.",
          ]}
        />
        <p>
          Payment and order records may be maintained as part of the user’s
          transaction history.
        </p>
        <p>
          Cancellation, refund, replacement, delivery, and similar
          transaction matters are subject to the applicable policies
          communicated by Dominant Asia Poultry Genetics for the particular
          transaction.
        </p>
      </LegalSection>

      <LegalSection heading="7. Seminar Services">
        <p>
          DACS may provide access to poultry education and seminar services
          offered by Dominant Asia Poultry Genetics.
        </p>
        <p>Available features may include:</p>
        <LegalBullets
          items={[
            "Seminar registration;",
            "Seminar Modules 1, 2, and 3;",
            "Video and learning materials;",
            "Progress monitoring;",
            "Assessments or quizzes;",
            "Quiz results;",
            "Seminar completion records; and",
            "Requests for certificates of attendance.",
          ]}
        />
        <p>
          Users are expected to personally complete required seminar
          activities and assessments unless Dominant Asia expressly allows
          otherwise.
        </p>
        <p>
          Users must not manipulate seminar progress, quiz results,
          completion records, or certificate requirements.
        </p>
        <p>
          Completion displayed in DACS may remain subject to verification by
          authorized Administrative Staff.
        </p>
      </LegalSection>

      <LegalSection heading="8. Seminar Certificates">
        <p>
          Eligible participants may request a Seminar Certificate of
          Attendance after completing the applicable seminar requirements.
        </p>
        <p>
          Submission of a certificate request does not constitute automatic
          approval.
        </p>
        <p>
          Dominant Asia may review seminar participation, module completion,
          quiz results, attendance records, or other relevant information
          before issuing or approving a certificate.
        </p>
        <p>
          Dominant Asia reserves the right to reject or correct a certificate
          request where records are incomplete, inaccurate, duplicated,
          fraudulent, or inconsistent with organizational requirements.
        </p>
      </LegalSection>

      <LegalSection heading="9. Breeder Eligibility and Certification">
        <p>
          DACS may maintain records relating to breeder eligibility and
          breeder certification.
        </p>
        <p>These records may include:</p>
        <LegalBullets
          items={[
            "Farmer information;",
            "Farm information;",
            "Parent Stock transactions;",
            "Parent Stock release dates;",
            "Breeder eligibility;",
            "Certification status;",
            "Certification date;",
            "Certification validity period;",
            "Expiration date; and",
            "Recertification information.",
          ]}
        />
        <p>
          Under the organizational rules currently designed for DACS, breeder
          eligibility monitoring may use the{" "}
          <strong>release date of a qualifying Parent Stock transaction</strong>{" "}
          as the reference date for the applicable{" "}
          <strong>90-day eligibility period</strong>.
        </p>
        <p>
          Breeder certification may also be monitored based on the applicable
          certification period, which under the current DACS requirements is{" "}
          <strong>two (2) years</strong>, subject to Dominant Asia’s
          verification and policies.
        </p>
        <p>DACS may classify breeder records using statuses such as:</p>
        <LegalBullets
          items={["Active;", "Pending;", "Expired; or", "Ineligible."]}
        />
        <p>
          Statuses displayed through DACS are based on the records and rules
          available to the system. Dominant Asia may review, verify, correct,
          approve, reject, suspend, expire, or update a breeder record where
          required by its certification procedures.
        </p>
        <p>
          A DACS status should not be interpreted as an independent
          government license, accreditation, or certification unless
          expressly identified as such by the appropriate authority.
        </p>
      </LegalSection>

      <LegalSection heading="10. Inquiry Management">
        <p>
          Users may submit inquiry tickets concerning Dominant Asia products,
          seminars, orders, payments, breeder certification, and other
          supported services.
        </p>
        <p>
          Each submitted inquiry may receive a reference or ticket number.
        </p>
        <p>DACS may display ticket statuses such as:</p>
        <LegalBullets
          items={["Submitted;", "Under Review;", "Responded; and", "Closed."]}
        />
        <p>
          DACS is primarily used to{" "}
          <strong>record and monitor the inquiry and its status</strong>.
        </p>
        <p>
          Actual responses and resolutions may be provided through the
          official email channel designated by Dominant Asia Poultry
          Genetics.
        </p>
        <p>
          DACS is not intended to function as an emergency service or
          guaranteed real-time messaging service.
        </p>
        <p>
          Users should avoid submitting the same inquiry repeatedly unless
          additional information is necessary.
        </p>
      </LegalSection>

      <LegalSection heading="11. File Uploads">
        <p>
          DACS may allow users to upload files including proof of payment,
          profile images, farm information, supporting records, and other
          documents required by system functions.
        </p>
        <p>By uploading a file, you confirm that:</p>
        <LegalBullets
          items={[
            "You are authorized to submit it;",
            "The information is relevant to the transaction or service;",
            "The file does not intentionally contain malicious software;",
            "The file does not infringe the rights of another person;",
            "The file does not contain unlawful material; and",
            "Any personal information belonging to another person has been provided only where you have an appropriate right or authority to provide it.",
          ]}
        />
        <p>
          Dominant Asia may reject, remove, restrict, or request replacement
          of files that do not meet system or organizational requirements.
        </p>
      </LegalSection>

      <LegalSection heading="12. Historical Records">
        <p>
          DACS may contain historical operational records migrated from
          previous systems or records maintained by Dominant Asia, including
          information originating from Google Forms, Google Sheets, and other
          organizational records.
        </p>
        <p>
          Because historical records may originate from older or previously
          separate systems, certain records may require validation,
          correction, consolidation, or manual review.
        </p>
        <p>
          Users who identify an inaccurate historical record should contact
          Dominant Asia or use the appropriate DACS process for requesting
          review.
        </p>
        <p>
          Users must not intentionally alter, falsify, or interfere with
          official historical records.
        </p>
      </LegalSection>

      <LegalSection heading="13. Acceptable Use">
        <p>You agree not to use DACS to:</p>
        <LegalBullets
          items={[
            "Violate any applicable law or regulation;",
            "Access another user's account without authorization;",
            "Attempt to bypass role or permission restrictions;",
            "Submit fraudulent orders, payments, certificates, or records;",
            "Falsify seminar participation or assessment results;",
            "Manipulate breeder eligibility or certification records;",
            "Upload viruses, malware, scripts, or harmful files;",
            "Attempt to interfere with DACS servers, databases, authentication systems, or network infrastructure;",
            "Scrape, extract, copy, or obtain system data without authorization;",
            "Probe or exploit security vulnerabilities without written authorization;",
            "Harass staff or other users through the inquiry system;",
            "Submit unlawful, threatening, abusive, deceptive, or harmful content;",
            "Use automated systems to create excessive traffic or submissions;",
            "Impersonate another person or organization; or",
            "Use DACS for purposes unrelated to the legitimate services of Dominant Asia Poultry Genetics.",
          ]}
        />
        <p>
          Security testing, penetration testing, vulnerability scanning, or
          similar activities may only be conducted with prior authorization.
        </p>
      </LegalSection>

      <LegalSection heading="14. Role-Based Access and Administrative Functions">
        <p>DACS uses role-based access controls.</p>
        <p>
          Access to customer records, payment information, breeder records,
          reports, administrative functions, system settings, user
          management, audit logs, and other restricted information may only
          be provided to authorized users.
        </p>
        <p>
          Users must not attempt to obtain access beyond the permissions
          assigned to their account.
        </p>
        <p>
          Dominant Asia may modify roles and permissions where necessary for
          security, organizational operations, staffing changes, or
          maintenance.
        </p>
      </LegalSection>

      <LegalSection heading="15. Privacy and Personal Data">
        <p>
          Use of DACS may involve the collection and processing of personal
          information and operational records necessary to provide the
          system’s services.
        </p>
        <p>This may include information relating to:</p>
        <LegalBullets
          items={[
            "Accounts and authentication;",
            "Customer profiles;",
            "Contact information;",
            "Farm information;",
            "Orders;",
            "Payments;",
            "Seminar participation;",
            "Assessments;",
            "Breeder eligibility and certification;",
            "Inquiry tickets;",
            "Uploaded documents;",
            "Transaction records; and",
            "System activity.",
          ]}
        />
        <p>
          Personal information will be handled in accordance with the
          applicable <strong>DACS Privacy Policy</strong> and applicable
          Philippine data privacy requirements.
        </p>
        <p>
          The Privacy Policy should be read together with these Terms and
          Conditions.
        </p>
        <p>
          Users should only provide personal information that is accurate,
          relevant, and appropriate for the service being requested.
        </p>
      </LegalSection>

      <LegalSection heading="16. Security">
        <p>
          Dominant Asia and the DACS administrators may implement reasonable
          technical and organizational safeguards designed to protect system
          accounts and information.
        </p>
        <p>
          However, no internet-based information system can guarantee
          uninterrupted operation or absolute protection against every
          security threat.
        </p>
        <p>
          Users are responsible for taking reasonable precautions when
          accessing DACS, including protecting their devices, accounts, and
          authentication credentials.
        </p>
        <p>
          Suspected unauthorized access, security incidents, or account
          compromise should be reported promptly.
        </p>
      </LegalSection>

      <LegalSection heading="17. System Availability and Maintenance">
        <p>DACS requires internet connectivity.</p>
        <p>
          The platform may occasionally become temporarily unavailable
          because of:
        </p>
        <LegalBullets
          items={[
            "Maintenance;",
            "Software updates;",
            "Server maintenance;",
            "Internet or telecommunications interruptions;",
            "Third-party service interruptions;",
            "Security incidents;",
            "Technical failures;",
            "Events beyond reasonable control; or",
            "Other operational requirements.",
          ]}
        />
        <p>
          Dominant Asia may temporarily suspend certain system functions
          where necessary to protect users, preserve data integrity, maintain
          the system, or address technical or security problems.
        </p>
        <p>
          Where reasonably possible, users may be informed of planned service
          interruptions.
        </p>
      </LegalSection>

      <LegalSection heading="18. Notifications">
        <p>
          DACS may provide system notifications relating to activities such
          as:
        </p>
        <LegalBullets
          items={[
            "Account activity;",
            "Customer registration;",
            "Order submission;",
            "Payment submission or verification;",
            "Seminar activity;",
            "Certificate approval;",
            "Breeder certification or expiration;",
            "Inquiry ticket updates; and",
            "Other supported system activities.",
          ]}
        />
        <p>
          Notifications are provided for convenience and should not replace a
          user’s responsibility to review the current information and status
          displayed in their DACS account.
        </p>
      </LegalSection>

      <LegalSection heading="19. Accuracy of Information">
        <p>
          Dominant Asia aims to maintain accurate information within DACS.
        </p>
        <p>However, some information may depend on:</p>
        <LegalBullets
          items={[
            "Data submitted by users;",
            "Administrative verification;",
            "Historical records;",
            "System processing;",
            "Third-party services; or",
            "Manual updates.",
          ]}
        />
        <p>
          If there is a discrepancy between a DACS record and an official
          verified organizational record, Dominant Asia may investigate the
          discrepancy and correct the system record where appropriate.
        </p>
        <p>
          Users should promptly report information they believe is
          incorrect.
        </p>
      </LegalSection>

      <LegalSection heading="20. Intellectual Property">
        <p>
          The DACS platform, including its software, system design,
          interface, databases, documentation, graphics, branding,
          educational materials, and other content, may contain intellectual
          property belonging to Dominant Asia Poultry Genetics, the DACS
          developers, licensors, or other respective rights holders.
        </p>
        <p>
          Access to DACS does not transfer ownership of such intellectual
          property to the user.
        </p>
        <p>
          Except where expressly permitted, users may not reproduce, modify,
          distribute, sell, reverse engineer, republish, or commercially
          exploit protected DACS materials without authorization.
        </p>
        <p>
          Information and documents uploaded by users remain subject to the
          rights of their respective owners.
        </p>
      </LegalSection>

      <LegalSection heading="21. Account Restriction or Suspension">
        <p>
          Dominant Asia may restrict, suspend, or terminate access to DACS
          where reasonably necessary, including where:
        </p>
        <LegalBullets
          items={[
            "These Terms are violated;",
            "Fraudulent information is submitted;",
            "A security threat is identified;",
            "Unauthorized access is attempted;",
            "The account is being misused;",
            "Continued access may compromise system security or information;",
            "The account is no longer authorized to use particular functions; or",
            "Restriction is required by law or legitimate organizational requirements.",
          ]}
        />
        <p>
          Where appropriate, users may be given an opportunity to contact
          Dominant Asia regarding the restriction.
        </p>
        <p>
          Suspending a DACS account does not automatically cancel outstanding
          obligations or legitimate transaction records associated with the
          account.
        </p>
      </LegalSection>

      <LegalSection heading="22. Disclaimer">
        <p>
          DACS is intended to facilitate Dominant Asia Poultry Genetics’
          operational and customer services.
        </p>
        <p>
          Information displayed in DACS is provided based on the information
          currently available to the system and may remain subject to
          administrative verification.
        </p>
        <p>
          DACS does not guarantee that every submission, order, payment,
          certificate request, breeder application, or inquiry will be
          approved.
        </p>
        <p>
          Product availability, certification decisions, payment
          verification, seminar certification, breeder eligibility, and
          similar organizational matters remain subject to the applicable
          requirements and verification procedures of Dominant Asia.
        </p>
        <p>
          Unless specifically identified otherwise, informational or
          educational material available through DACS should not be
          interpreted as independent professional veterinary, medical,
          financial, or legal advice.
        </p>
      </LegalSection>

      <LegalSection heading="23. Limitation of Liability">
        <p>
          To the extent permitted by applicable law, Dominant Asia Poultry
          Genetics and the authorized operators of DACS will not be
          responsible for indirect or consequential losses caused solely by
          circumstances outside their reasonable control, including internet
          outages, third-party service interruptions, user device problems,
          or unauthorized actions by users.
        </p>
        <p>
          Nothing in these Terms is intended to exclude or limit any
          responsibility that cannot legally be excluded or limited.
        </p>
        <p>
          Users remain responsible for ensuring that information, documents,
          orders, and files they submit through DACS are correct before
          submission.
        </p>
      </LegalSection>

      <LegalSection heading="24. Changes to DACS">
        <p>DACS may be updated, modified, expanded, or improved over time.</p>
        <p>
          Features may be introduced, redesigned, replaced, restricted, or
          removed according to organizational requirements, technical
          requirements, user feedback, security needs, or future development.
        </p>
        <p>
          These changes may include changes to available modules, eligibility
          rules, transaction workflows, user roles, reporting capabilities,
          or other system functions.
        </p>
      </LegalSection>

      <LegalSection heading="25. Changes to These Terms">
        <p>
          Dominant Asia may update these Terms when necessary to reflect
          changes in:
        </p>
        <LegalBullets
          items={[
            "DACS functionality;",
            "Organizational policies;",
            "Security requirements;",
            "Operational procedures; or",
            "Applicable legal or regulatory requirements.",
          ]}
        />
        <p>
          The latest version should display its effective date or last
          updated date.
        </p>
        <p>
          Where a significant change materially affects users, reasonable
          notice may be provided through DACS, email, or another appropriate
          communication method.
        </p>
        <p>
          Continued use of DACS after updated Terms become effective
          constitutes acceptance of the updated Terms to the extent permitted
          by applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="26. Governing Law">
        <p>
          These Terms shall be governed by and interpreted in accordance with
          the applicable laws of the{" "}
          <strong>Republic of the Philippines</strong>.
        </p>
        <p>
          Any rights, obligations, or remedies provided by applicable
          Philippine law remain unaffected where they cannot legally be
          waived or restricted by these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="27. Severability">
        <p>
          If any provision of these Terms is determined to be invalid,
          unlawful, or unenforceable, the remaining provisions will continue
          to apply to the extent permitted by law.
        </p>
      </LegalSection>

      <LegalSection heading="28. Contact Information">
        <p>
          Questions, concerns, correction requests, or reports regarding DACS
          and these Terms may be directed to:
        </p>
        <p className="text-start">
          <strong>Dominant Asia Poultry Genetics</strong>
          <br />
          <strong>Email:</strong> [Official DACS/Dominant Asia Email]
          <br />
          <strong>Contact Number:</strong> [Contact Number]
          <br />
          <strong>Business Address:</strong> [Business Address]
        </p>
        <p>
          For matters concerning personal information and privacy, please
          refer to the <strong>DACS Privacy Policy</strong> and the privacy
          contact information provided there.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptance of Terms">
        <p>
          By selecting{" "}
          <strong>“I Agree,” “Accept,” or a similar confirmation</strong>, or
          by creating and using a DACS account after being presented with
          these Terms, you acknowledge that you have read and understood the
          DACS Terms and Conditions and agree to comply with them.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
