export function AccessDenied({ pageName }: { pageName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-32 text-center">
      <h2 className="text-3xl font-bold text-dacs-red">Access Denied</h2>
      <p className="max-w-md text-dacs-dark">
        Your account does not have permission to access {pageName}.
        <br />
        Please contact your Owner or Admin for access.
      </p>
    </div>
  );
}
