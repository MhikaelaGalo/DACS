export function seminarRegistrationBody(...moduleIds: string[]) {
  return {
    fullName: "Seminar Test Farmer",
    email: "seminar@example.invalid",
    contactNumber: "09170000000",
    gender: "Prefer not to say",
    facebookName: "Seminar Farmer",
    occupation: "Farmer",
    homeFarmAddress: "Test Farm",
    country: "Philippines",
    isReEnrollee: false,
    moduleIds,
  };
}
