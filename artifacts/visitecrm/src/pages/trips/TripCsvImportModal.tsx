import { OperationalImportModal } from "@/components/operational-import-modal";

interface TripCsvImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function TripCsvImportModal(props: TripCsvImportModalProps) {
  return <OperationalImportModal entity="trips" title="Importar viagens por planilha" {...props} />;
}