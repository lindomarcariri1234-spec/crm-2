import { OperationalImportModal } from "@/components/operational-import-modal";

interface ReservationCsvImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ReservationCsvImportModal(props: ReservationCsvImportModalProps) {
  return <OperationalImportModal entity="reservations" title="Importar reservas por planilha" {...props} />;
}