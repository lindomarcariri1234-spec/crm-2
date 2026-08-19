import { useRoute } from "wouter";
import { TripForm } from "./trips/TripForm";
import { TripList } from "./trips/TripList";
import { SeatMap } from "./trips/SeatMap";
import { PassengersOverview } from "./trips/PassengersOverview";
import { PassengersList } from "./trips/PassengersList";
import { TripCalendar } from "./trips/TripCalendar";
import { TripCheckinPanel } from "./trips/TripCheckinPanel";
import { TabletCheckin } from "./trips/TabletCheckin";
import { BoardingControlPage } from "./trips/BoardingControlPage";
import { TripNpsTab } from "./trips/TripNpsTab";
import { TripMediaGallery } from "./trips/TripMediaGallery";

export { TripForm, TripList, SeatMap, PassengersOverview, PassengersList, TripCalendar };

export default function Trips() {
  const [matchNew] = useRoute("/trips/new");
  const [matchCalendar] = useRoute("/trips/calendar");
  const [matchMedia] = useRoute("/trips/media");
  const [matchEdit, paramsEdit] = useRoute("/trips/:id/edit");
  const [matchSeatMap, paramsSeatMap] = useRoute("/trips/:id/seat-map");
  const [matchPassengersOverview, paramsPassengersOverview] = useRoute("/trips/:id/passengers-overview");
  const [matchPassengers, paramsPassengers] = useRoute("/trips/:id/passengers");
  const [matchCheckinPanel, paramsCheckinPanel] = useRoute("/trips/:id/checkin-panel");
  const [matchTabletCheckin, paramsTabletCheckin] = useRoute("/trips/:id/checkin");
  const [matchBoardingControl, paramsBoardingControl] = useRoute("/trips/:id/boarding-control");
  const [matchNps, paramsNps] = useRoute("/trips/:id/nps");
  const [matchDetail, paramsDetail] = useRoute("/trips/:id");

  if (matchNew) return <TripForm />;
  if (matchCalendar) return <TripCalendar />;
  if (matchMedia) return <TripMediaGallery />;
  if (matchEdit && paramsEdit?.id) return <TripForm tripId={paramsEdit.id} />;
  if (matchSeatMap && paramsSeatMap?.id) return <SeatMap tripId={paramsSeatMap.id} />;
  if (matchPassengersOverview && paramsPassengersOverview?.id) return <PassengersOverview tripId={paramsPassengersOverview.id} />;
  if (matchPassengers && paramsPassengers?.id) return <PassengersList tripId={paramsPassengers.id} />;
  if (matchCheckinPanel && paramsCheckinPanel?.id) return <TripCheckinPanel tripId={paramsCheckinPanel.id} />;
  if (matchTabletCheckin && paramsTabletCheckin?.id) return <TabletCheckin tripId={paramsTabletCheckin.id} />;
  if (matchBoardingControl && paramsBoardingControl?.id) return <BoardingControlPage tripId={paramsBoardingControl.id} />;
  if (matchNps && paramsNps?.id) return <TripNpsTab tripId={paramsNps.id} />;
  if (matchDetail && paramsDetail?.id) return <PassengersOverview tripId={paramsDetail.id} />;

  return <TripList />;
}
