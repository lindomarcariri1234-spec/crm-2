 { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetNotificationsQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getNotifications>>
  > = ({ signal }) => getNotifications({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getNotifications>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetNotificationsQueryResult = NonNullable<
  Awaited<ReturnType<typeof getNotifications>>
>;
export type GetNotificationsQueryError = ErrorType<unknown>;

/**
 * @summary Get computed alert notifications
 */

export function useGetNotifications<
  TData = Awaited<ReturnType<typeof getNotifications>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getNotifications>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetNotificationsQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get Google OAuth URL to connect Google Calendar
 */
export const getGetCalendarConnectUrlUrl = () => {
  return `/api/calendar/connect`;
};

export const getCalendarConnectUrl = async (
  options?: RequestInit,
): Promise<CalendarConnectResponse> => {
  return customFetch<CalendarConnectResponse>(getGetCalendarConnectUrlUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetCalendarConnectUrlQueryKey = () => {
  return [`/api/calendar/connect`] as const;
};

export const getGetCalendarConnectUrlQueryOptions = <
  TData = Awaited<ReturnType<typeof getCalendarConnectUrl>>,
  TError = ErrorType<void>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCalendarConnectUrl>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetCalendarConnectUrlQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getCalendarConnectUrl>>
  > = ({ signal }) => getCalendarConnectUrl({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getCalendarConnectUrl>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetCalendarConnectUrlQueryResult = NonNullable<
  Awaited<ReturnType<typeof getCalendarConnectUrl>>
>;
export type GetCalendarConnectUrlQueryError = ErrorType<void>;

/**
 * @summary Get Google OAuth URL to connect Google Calendar
 */

export function useGetCalendarConnectUrl<
  TData = Awaited<ReturnType<typeof getCalendarConnectUrl>>,
  TError = ErrorType<void>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCalendarConnectUrl>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetCalendarConnectUrlQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Disconnect Google Calendar and revoke tokens
 */
export const getDisconnectCalendarUrl = () => {
  return `/api/calendar/disconnect`;
};

export const disconnectCalendar = async (
  options?: RequestInit,
): Promise<SuccessResponse> => {
  return customFetch<SuccessResponse>(getDisconnectCalendarUrl(), {
    ...options,
    method: "POST",
  });
};

export const getDisconnectCalendarMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof disconnectCalendar>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof disconnectCalendar>>,
  TError,
  void,
  TContext
> => {
  const mutationKey = ["disconnectCalendar"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof disconnectCalendar>>,
    void
  > = () => {
    return disconnectCalendar(requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type DisconnectCalendarMutationResult = NonNullable<
  Awaited<ReturnType<typeof disconnectCalendar>>
>;

export type DisconnectCalendarMutationError = ErrorType<unknown>;

/**
 * @summary Disconnect Google Calendar and revoke tokens
 */
export const useDisconnectCalendar = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof disconnectCalendar>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof disconnectCalendar>>,
  TError,
  void,
  TContext
> => {
  return useMutation(getDisconnectCalendarMutationOptions(options));
};

/**
 * @summary Get current Google Calendar connection status
 */
export const getGetCalendarStatusUrl = () => {
  return `/api/calendar/status`;
};

export const getCalendarStatus = async (
  options?: RequestInit,
): Promise<CalendarStatus> => {
  return customFetch<CalendarStatus>(getGetCalendarStatusUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetCalendarStatusQueryKey = () => {
  return [`/api/calendar/status`] as const;
};

export const getGetCalendarStatusQueryOptions = <
  TData = Awaited<ReturnType<typeof getCalendarStatus>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCalendarStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetCalendarStatusQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getCalendarStatus>>
  > = ({ signal }) => getCalendarStatus({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getCalendarStatus>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetCalendarStatusQueryResult = NonNullable<
  Awaited<ReturnType<typeof getCalendarStatus>>
>;
export type GetCalendarStatusQueryError = ErrorType<unknown>;

/**
 * @summary Get current Google Calendar connection status
 */

export function useGetCalendarStatus<
  TData = Awaited<ReturnType<typeof getCalendarStatus>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getCalendarStatus>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetCalendarStatusQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Trigger manual calendar sync
 */
export const getSyncCalendarUrl = () => {
  return `/api/calendar/sync`;
};

export const syncCalendar = async (
  calendarSyncRequest: CalendarSyncRequest,
  options?: RequestInit,
): Promise<CalendarSyncResponse> => {
  return customFetch<CalendarSyncResponse>(getSyncCalendarUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(calendarSyncRequest),
  });
};

export const getSyncCalendarMutationOptions = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof syncCalendar>>,
    TError,
    { data: BodyType<CalendarSyncRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof syncCalendar>>,
  TError,
  { data: BodyType<CalendarSyncRequest> },
  TContext
> => {
  const mutationKey = ["syncCalendar"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof syncCalendar>>,
    { data: BodyType<CalendarSyncRequest> }
  > = (props) => {
    const { data } = props ?? {};

    return syncCalendar(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type SyncCalendarMutationResult = NonNullable<
  Awaited<ReturnType<typeof syncCalendar>>
>;
export type SyncCalendarMutationBody = BodyType<CalendarSyncRequest>;
export type SyncCalendarMutationError = ErrorType<void>;

/**
 * @summary Trigger manual calendar sync
 */
export const useSyncCalendar = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof syncCalendar>>,
    TError,
    { data: BodyType<CalendarSyncRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof syncCalendar>>,
  TError,
  { data: BodyType<CalendarSyncRequest> },
  TContext
> => {
  return useMutation(getSyncCalendarMutationOptions(options));
};

/**
 * @summary Find orphaned pre-deterministic calendar events for review
 */
export const getScanLegacyCalendarEventsUrl = () => {
  return `/api/calendar/reconciliation/scan`;
};

export const scanLegacyCalendarEvents = async (
  calendarReconciliationScanRequest?: CalendarReconciliationScanRequest,
  options?: RequestInit,
): Promise<CalendarReconciliationScanResponse> => {
  return customFetch<CalendarReconciliationScanResponse>(
    getScanLegacyCalendarEventsUrl(),
    {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...options?.headers },
      body: JSON.stringify(calendarReconciliationScanRequest),
    },
  );
};

export const getScanLegacyCalendarEventsMutationOptions = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof scanLegacyCalendarEvents>>,
    TError,
    { data: BodyType<CalendarReconciliationScanRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof scanLegacyCalendarEvents>>,
  TError,
  { data: BodyType<CalendarReconciliationScanRequest> },
  TContext
> => {
  const mutationKey = ["scanLegacyCalendarEvents"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof scanLegacyCalendarEvents>>,
    { data: BodyType<CalendarReconciliationScanRequest> }
  > = (props) => {
    const { data } = props ?? {};

    return scanLegacyCalendarEvents(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type ScanLegacyCalendarEventsMutationResult = NonNullable<
  Awaited<ReturnType<typeof scanLegacyCalendarEvents>>
>;
export type ScanLegacyCalendarEventsMutationBody =
  BodyType<CalendarReconciliationScanRequest>;
export type ScanLegacyCalendarEventsMutationError = ErrorType<void>;

/**
 * @summary Find orphaned pre-deterministic calendar events for review
 */
export const useScanLegacyCalendarEvents = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof scanLegacyCalendarEvents>>,
    TError,
    { data: BodyType<CalendarReconciliationScanRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof scanLegacyCalendarEvents>>,
  TError,
  { data: BodyType<CalendarReconciliationScanRequest> },
  TContext
> => {
  return useMutation(getScanLegacyCalendarEventsMutationOptions(options));
};

/**
 * @summary List calendar events awaiting legacy reconciliation review
 */
export const getListCalendarReconciliationsUrl = (
  params?: ListCalendarReconciliationsParams,
) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/calendar/reconciliation?${stringifiedParams}`
    : `/api/calendar/reconciliation`;
};

export const listCalendarReconciliations = async (
  params?: ListCalendarReconciliationsParams,
  options?: RequestInit,
): Promise<CalendarReconciliationListResponse> => {
  return customFetch<CalendarReconciliationListResponse>(
    getListCalendarReconciliationsUrl(params),
    {
      ...options,
      method: "GET",
    },
  );
};

export const getListCalendarReconciliationsQueryKey = (
  params?: ListCalendarReconciliationsParams,
) => {
  return [`/api/calendar/reconciliation`, ...(params ? [params] : [])] as const;
};

export const getListCalendarReconciliationsQueryOptions = <
  TData = Awaited<ReturnType<typeof listCalendarReconciliations>>,
  TError = ErrorType<void>,
>(
  params?: ListCalendarReconciliationsParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listCalendarReconciliations>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getListCalendarReconciliationsQueryKey(params);

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof listCalendarReconciliations>>
  > = ({ signal }) =>
    listCalendarReconciliations(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listCalendarReconciliations>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListCalendarReconciliationsQueryResult = NonNullable<
  Awaited<ReturnType<typeof listCalendarReconciliations>>
>;
export type ListCalendarReconciliationsQueryError = ErrorType<void>;

/**
 * @summary List calendar events awaiting legacy reconciliation review
 */

export function useListCalendarReconciliations<
  TData = Awaited<ReturnType<typeof listCalendarReconciliations>>,
  TError = ErrorType<void>,
>(
  params?: ListCalendarReconciliationsParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listCalendarReconciliations>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListCalendarReconciliationsQueryOptions(
    params,
    options,
  );

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Associate a reviewed legacy calendar event with a CRM record
 */
export const getAssociateLegacyCalendarEventUrl = (id: string) => {
  return `/api/calendar/reconciliation/${id}/associate`;
};

export const associateLegacyCalendarEvent = async (
  id: string,
  calendarReconciliationAssociateRequest: CalendarReconciliationAssociateRequest,
  options?: RequestInit,
): Promise<CalendarReconciliationActionResponse> => {
  return customFetch<CalendarReconciliationActionResponse>(
    getAssociateLegacyCalendarEventUrl(id),
    {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...options?.headers },
      body: JSON.stringify(calendarReconciliationAssociateRequest),
    },
  );
};

export const getAssociateLegacyCalendarEventMutationOptions = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof associateLegacyCalendarEvent>>,
    TError,
    { id: string; data: BodyType<CalendarReconciliationAssociateRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof associateLegacyCalendarEvent>>,
  TError,
  { id: string; data: BodyType<CalendarReconciliationAssociateRequest> },
  TContext
> => {
  const mutationKey = ["associateLegacyCalendarEvent"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof associateLegacyCalendarEvent>>,
    { id: string; data: BodyType<CalendarReconciliationAssociateRequest> }
  > = (props) => {
    const { id, data } = props ?? {};

    return associateLegacyCalendarEvent(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type AssociateLegacyCalendarEventMutationResult = NonNullable<
  Awaited<ReturnType<typeof associateLegacyCalendarEvent>>
>;
export type AssociateLegacyCalendarEventMutationBody =
  BodyType<CalendarReconciliationAssociateRequest>;
export type AssociateLegacyCalendarEventMutationError = ErrorType<void>;

/**
 * @summary Associate a reviewed legacy calendar event with a CRM record
 */
export const useAssociateLegacyCalendarEvent = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof associateLegacyCalendarEvent>>,
    TError,
    { id: string; data: BodyType<CalendarReconciliationAssociateRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof associateLegacyCalendarEvent>>,
  TError,
  { id: string; data: BodyType<CalendarReconciliationAssociateRequest> },
  TContext
> => {
  return useMutation(getAssociateLegacyCalendarEventMutationOptions(options));
};

/**
 * @summary Remove a reviewed legacy event from Google Calendar
 */
export const getRemoveLegacyCalendarEventUrl = (id: string) => {
  return `/api/calendar/reconciliation/${id}/remove`;
};

export const removeLegacyCalendarEvent = async (
  id: string,
  options?: RequestInit,
): Promise<CalendarReconciliationActionResponse> => {
  return customFetch<CalendarReconciliationActionResponse>(
    getRemoveLegacyCalendarEventUrl(id),
    {
      ...options,
      method: "POST",
    },
  );
};

export const getRemoveLegacyCalendarEventMutationOptions = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof removeLegacyCalendarEvent>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof removeLegacyCalendarEvent>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["removeLegacyCalendarEvent"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof removeLegacyCalendarEvent>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return removeLegacyCalendarEvent(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RemoveLegacyCalendarEventMutationResult = NonNullable<
  Awaited<ReturnType<typeof removeLegacyCalendarEvent>>
>;

export type RemoveLegacyCalendarEventMutationError = ErrorType<void>;

/**
 * @summary Remove a reviewed legacy event from Google Calendar
 */
export const useRemoveLegacyCalendarEvent = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof removeLegacyCalendarEvent>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof removeLegacyCalendarEvent>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getRemoveLegacyCalendarEventMutationOptions(options));
};

/**
 * @summary Dismiss a legacy candidate without changing Google Calendar
 */
export const getDismissLegacyCalendarEventUrl = (id: string) => {
  return `/api/calendar/reconciliation/${id}/dismiss`;
};

export const dismissLegacyCalendarEvent = async (
  id: string,
  options?: RequestInit,
): Promise<CalendarReconciliationActionResponse> => {
  return customFetch<CalendarReconciliationActionResponse>(
    getDismissLegacyCalendarEventUrl(id),
    {
      ...options,
      method: "POST",
    },
  );
};

export const getDismissLegacyCalendarEventMutationOptions = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof dismissLegacyCalendarEvent>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof dismissLegacyCalendarEvent>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["dismissLegacyCalendarEvent"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof dismissLegacyCalendarEvent>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return dismissLegacyCalendarEvent(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type DismissLegacyCalendarEventMutationResult = NonNullable<
  Awaited<ReturnType<typeof dismissLegacyCalendarEvent>>
>;

export type DismissLegacyCalendarEventMutationError = ErrorType<void>;

/**
 * @summary Dismiss a legacy candidate without changing Google Calendar
 */
export const useDismissLegacyCalendarEvent = <
  TError = ErrorType<void>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof dismissLegacyCalendarEvent>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof dismissLegacyCalendarEvent>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getDismissLegacyCalendarEventMutationOptions(options));
};

/**
 * Receives the authorization code from Google after the user grants access. Verifies the HMAC-signed `state` parameter, exchanges the code for tokens, persists them in the users table, triggers an initial syncAll, and redirects back to the Configurações page with a `?gcal=connected|denied|error` query parameter.

 * @summary Google OAuth2 callback (server-side redirect handler)
 */
export const getGetCalendarCallbackUrl = (
  params?: GetCalendarCallbackParams,
) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/calendar/callback?${stringifiedParams}`
    : `/api/calendar/callback`;
};

export const getCalendarCallback = async (
  params?: GetCalendarCallbackParams,
  options?: RequestInit,
): Promise<unknown> => {
  return customFetch<unknown>(getGetCalendarCallbackUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getGetCalendarCallbackQueryKey = (
  params?: GetCalendarCallbackParams,
) => {
  return [`/api/calendar/callback`, ...(params ? [params] : [])] as const;
};

export const getGetCalendarCallbackQueryOptions = <
  TData = Awaited<ReturnType<typeof getCalendarCallback>>,
  TError = ErrorType<void>,
>(
  params?: GetCalendarCallbackParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getCalendarCallback>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getGetCalendarCallbackQueryKey(params);

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getCalendarCallback>>
  > = ({ signal }) =>
    getCalendarCallback(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getCalendarCallback>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetCalendarCallbackQueryResult = NonNullable<
  Awaited<ReturnType<typeof getCalendarCallback>>
>;
export type GetCalendarCallbackQueryError = ErrorType<void>;

/**
 * @summary Google OAuth2 callback (server-side redirect handler)
 */

export function useGetCalendarCallback<
  TData = Awaited<ReturnType<typeof getCalendarCallback>>,
  TError = ErrorType<void>,
>(
  params?: GetCalendarCallbackParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getCalendarCallback>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetCalendarCallbackQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Check active Stripe prices for platform plans
 */
export const getGetPlansStripeHealthUrl = () => {
  return `/api/admin/plans/stripe-health`;
};

export const getPlansStripeHealth = async (
  options?: RequestInit,
): Promise<PlansStripeHealth> => {
  return customFetch<PlansStripeHealth>(getGetPlansStripeHealthUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetPlansStripeHealthQueryKey = () => {
  return [`/api/admin/plans/stripe-health`] as const;
};

export const getGetPlansStripeHealthQueryOptions = <
  TData = Awaited<ReturnType<typeof getPlansStripeHealth>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getPlansStripeHealth>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetPlansStripeHealthQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getPlansStripeHealth>>
  > = ({ signal }) => getPlansStripeHealth({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getPlansStripeHealth>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetPlansStripeHealthQueryResult = NonNullable<
  Awaited<ReturnType<typeof getPlansStripeHealth>>
>;
export type GetPlansStripeHealthQueryError = ErrorType<unknown>;

/**
 * @summary Check active Stripe prices for platform plans
 */

export function useGetPlansStripeHealth<
  TData = Awaited<ReturnType<typeof getPlansStripeHealth>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getPlansStripeHealth>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetPlansStripeHealthQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get twelve-month revenue, expense, profit, and reservation comparison
 */
export const getGetDashboardComparativeUrl = () => {
  return `/api/dashboard/comparative`;
};

export const getDashboardComparative = async (
  options?: RequestInit,
): Promise<DashboardComparativePoint[]> => {
  return customFetch<DashboardComparativePoint[]>(
    getGetDashboardComparativeUrl(),
    {
      ...options,
      method: "GET",
    },
  );
};

export const getGetDashboardComparativeQueryKey = () => {
  return [`/api/dashboard/comparative`] as const;
};

export const getGetDashboardComparativeQueryOptions = <
  TData = Awaited<ReturnType<typeof getDashboardComparative>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardComparative>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getGetDashboardComparativeQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getDashboardComparative>>
  > = ({ signal }) => getDashboardComparative({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardComparative>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetDashboardComparativeQueryResult = NonNullable<
  Awaited<ReturnType<typeof getDashboardComparative>>
>;
export type GetDashboardComparativeQueryError = ErrorType<unknown>;

/**
 * @summary Get twelve-month revenue, expense, profit, and reservation comparison
 */

export function useGetDashboardComparative<
  TData = Awaited<ReturnType<typeof getDashboardComparative>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardComparative>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetDashboardComparativeQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get the five highest-spending customers
 */
export const getGetDashboardTopCustomersUrl = () => {
  return `/api/dashboard/top-customers`;
};

export const getDashboardTopCustomers = async (
  options?: RequestInit,
): Promise<DashboardTopCustomer[]> => {
  return customFetch<DashboardTopCustomer[]>(getGetDashboardTopCustomersUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetDashboardTopCustomersQueryKey = () => {
  return [`/api/dashboard/top-customers`] as const;
};

export const getGetDashboardTopCustomersQueryOptions = <
  TData = Awaited<ReturnType<typeof getDashboardTopCustomers>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardTopCustomers>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getGetDashboardTopCustomersQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getDashboardTopCustomers>>
  > = ({ signal }) => getDashboardTopCustomers({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardTopCustomers>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetDashboardTopCustomersQueryResult = NonNullable<
  Awaited<ReturnType<typeof getDashboardTopCustomers>>
>;
export type GetDashboardTopCustomersQueryError = ErrorType<unknown>;

/**
 * @summary Get the five highest-spending customers
 */

export function useGetDashboardTopCustomers<
  TData = Awaited<ReturnType<typeof getDashboardTopCustomers>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardTopCustomers>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetDashboardTopCustomersQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get the strategic insights summary
 */
export const getGetInsightsSummaryUrl = (params?: GetInsightsSummaryParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/insights/summary?${stringifiedParams}`
    : `/api/insights/summary`;
};

export const getInsightsSummary = async (
  params?: GetInsightsSummaryParams,
  options?: RequestInit,
): Promise<InsightsSummary> => {
  return customFetch<InsightsSummary>(getGetInsightsSummaryUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getGetInsightsSummaryQueryKey = (
  params?: GetInsightsSummaryParams,
) => {
  return [`/api/insights/summary`, ...(params ? [params] : [])] as const;
};

export const getGetInsightsSummaryQueryOptions = <
  TData = Awaited<ReturnType<typeof getInsightsSummary>>,
  TError = ErrorType<unknown>,
>(
  params?: GetInsightsSummaryParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getInsightsSummary>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getGetInsightsSummaryQueryKey(params);

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getInsightsSummary>>
  > = ({ signal }) => getInsightsSummary(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getInsightsSummary>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetInsightsSummaryQueryResult = NonNullable<
  Awaited<ReturnType<typeof getInsightsSummary>>
>;
export type GetInsightsSummaryQueryError = ErrorType<unknown>;

/**
 * @summary Get the strategic insights summary
 */

export function useGetInsightsSummary<
  TData = Awaited<ReturnType<typeof getInsightsSummary>>,
  TError = ErrorType<unknown>,
>(
  params?: GetInsightsSummaryParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getInsightsSummary>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetInsightsSummaryQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Regenerate a trip seat map from its vehicle layout
 */
export const getRegenerateTripSeatMapUrl = (id: string) => {
  return `/api/trips/${id}/regenerate-seat-map`;
};

export const regenerateTripSeatMap = async (
  id: string,
  options?: RequestInit,
): Promise<Trip> => {
  return customFetch<Trip>(getRegenerateTripSeatMapUrl(id), {
    ...options,
    method: "POST",
  });
};

export const getRegenerateTripSeatMapMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof regenerateTripSeatMap>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof regenerateTripSeatMap>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["regenerateTripSeatMap"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof regenerateTripSeatMap>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return regenerateTripSeatMap(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RegenerateTripSeatMapMutationResult = NonNullable<
  Awaited<ReturnType<typeof regenerateTripSeatMap>>
>;

export type RegenerateTripSeatMapMutationError = ErrorType<unknown>;

/**
 * @summary Regenerate a trip seat map from its vehicle layout
 */
export const useRegenerateTripSeatMap = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof regenerateTripSeatMap>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof regenerateTripSeatMap>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getRegenerateTripSeatMapMutationOptions(options));
};

/**
 * @summary Check in a complimentary trip passenger
 */
export const getCheckInFreePassengerUrl = (id: string, fpId: string) => {
  return `/api/trips/${id}/free-passengers/${fpId}/check-in`;
};

export const checkInFreePassenger = async (
  id: string,
  fpId: string,
  options?: RequestInit,
): Promise<FreePassengerCheckIn> => {
  return customFetch<FreePassengerCheckIn>(
    getCheckInFreePassengerUrl(id, fpId),
    {
      ...options,
      method: "POST",
    },
  );
};

export const getCheckInFreePassengerMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof checkInFreePassenger>>,
    TError,
    { id: string; fpId: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof checkInFreePassenger>>,
  TError,
  { id: string; fpId: string },
  TContext
> => {
  const mutationKey = ["checkInFreePassenger"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof checkInFreePassenger>>,
    { id: string; fpId: string }
  > = (props) => {
    const { id, fpId } = props ?? {};

    return checkInFreePassenger(id, fpId, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CheckInFreePassengerMutationResult = NonNullable<
  Awaited<ReturnType<typeof checkInFreePassenger>>
>;

export type CheckInFreePassengerMutationError = ErrorType<unknown>;

/**
 * @summary Check in a complimentary trip passenger
 */
export const useCheckInFreePassenger = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof checkInFreePassenger>>,
    TError,
    { id: string; fpId: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof checkInFreePassenger>>,
  TError,
  { id: string; fpId: string },
  TContext
> => {
  return useMutation(getCheckInFreePassengerMutationOptions(options));
};

/**
 * @summary Undo a complimentary passenger check-in
 */
export const getUndoCheckInFreePassengerUrl = (id: string, fpId: string) => {
  return `/api/trips/${id}/free-passengers/${fpId}/check-in`;
};

export const undoCheckInFreePassenger = async (
  id: string,
  fpId: string,
  options?: RequestInit,
): Promise<FreePassengerCheckIn> => {
  return customFetch<FreePassengerCheckIn>(
    getUndoCheckInFreePassengerUrl(id, fpId),
    {
      ...options,
      method: "DELETE",
    },
  );
};

export const getUndoCheckInFreePassengerMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof undoCheckInFreePassenger>>,
    TError,
    { id: string; fpId: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof undoCheckInFreePassenger>>,
  TError,
  { id: string; fpId: string },
  TContext
> => {
  const mutationKey = ["undoCheckInFreePassenger"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof undoCheckInFreePassenger>>,
    { id: string; fpId: string }
  > = (props) => {
    const { id, fpId } = props ?? {};

    return undoCheckInFreePassenger(id, fpId, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UndoCheckInFreePassengerMutationResult = NonNullable<
  Awaited<ReturnType<typeof undoCheckInFreePassenger>>
>;

export type UndoCheckInFreePassengerMutationError = ErrorType<unknown>;

/**
 * @summary Undo a complimentary passenger check-in
 */
export const useUndoCheckInFreePassenger = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof undoCheckInFreePassenger>>,
    TError,
    { id: string; fpId: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof undoCheckInFreePassenger>>,
  TError,
  { id: string; fpId: string },
  TContext
> => {
  return useMutation(getUndoCheckInFreePassengerMutationOptions(options));
};

/**
 * @summary Queue a WhatsApp broadcast for trip passengers
 */
export const getBroadcastTripWhatsAppUrl = (id: string) => {
  return `/api/trips/${id}/whatsapp-broadcast`;
};

export const broadcastTripWhatsApp = async (
  id: string,
  whatsAppBroadcastBody: WhatsAppBroadcastBody,
  options?: RequestInit,
): Promise<WhatsAppBroadcastResult> => {
  return customFetch<WhatsAppBroadcastResult>(getBroadcastTripWhatsAppUrl(id), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(whatsAppBroadcastBody),
  });
};

export const getBroadcastTripWhatsAppMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof broadcastTripWhatsApp>>,
    TError,
    { id: string; data: BodyType<WhatsAppBroadcastBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof broadcastTripWhatsApp>>,
  TError,
  { id: string; data: BodyType<WhatsAppBroadcastBody> },
  TContext
> => {
  const mutationKey = ["broadcastTripWhatsApp"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof broadcastTripWhatsApp>>,
    { id: string; data: BodyType<WhatsAppBroadcastBody> }
  > = (props) => {
    const { id, data } = props ?? {};

    return broadcastTripWhatsApp(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type BroadcastTripWhatsAppMutationResult = NonNullable<
  Awaited<ReturnType<typeof broadcastTripWhatsApp>>
>;
export type BroadcastTripWhatsAppMutationBody = BodyType<WhatsAppBroadcastBody>;
export type BroadcastTripWhatsAppMutationError = ErrorType<unknown>;

/**
 * @summary Queue a WhatsApp broadcast for trip passengers
 */
export const useBroadcastTripWhatsApp = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof broadcastTripWhatsApp>>,
    TError,
    { id: string; data: BodyType<WhatsAppBroadcastBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof broadcastTripWhatsApp>>,
  TError,
  { id: string; data: BodyType<WhatsAppBroadcastBody> },
  TContext
> => {
  return useMutation(getBroadcastTripWhatsAppMutationOptions(options));
};

/**
 * @summary Mark a converted referral bonus as paid
 */
export const getPayReferralBonusUrl = (id: string) => {
  return `/api/referrals/${id}/pay-bonus`;
};

export const payReferralBonus = async (
  id: string,
  options?: RequestInit,
): Promise<Referral> => {
  return customFetch<Referral>(getPayReferralBonusUrl(id), {
    ...options,
    method: "POST",
  });
};

export const getPayReferralBonusMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof payReferralBonus>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof payReferralBonus>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["payReferralBonus"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof payReferralBonus>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return payReferralBonus(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type PayReferralBonusMutationResult = NonNullable<
  Awaited<ReturnType<typeof payReferralBonus>>
>;

export type PayReferralBonusMutationError = ErrorType<unknown>;

/**
 * @summary Mark a converted referral bonus as paid
 */
export const usePayReferralBonus = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof payReferralBonus>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof payReferralBonus>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getPayReferralBonusMutationOptions(options));
};

/**
 * @summary Resend a referral expiry warning
 */
export const getResendExpiryWarningUrl = (
  id: string,
  params: ResendExpiryWarningParams,
) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/referrals/${id}/resend-expiry-warning?${stringifiedParams}`
    : `/api/referrals/${id}/resend-expiry-warning`;
};

export const resendExpiryWarning = async (
  id: string,
  params: ResendExpiryWarningParams,
  options?: RequestInit,
): Promise<Referral> => {
  return customFetch<Referral>(getResendExpiryWarningUrl(id, params), {
    ...options,
    method: "POST",
  });
};

export const getResendExpiryWarningMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof resendExpiryWarning>>,
    TError,
    { id: string; params: ResendExpiryWarningParams },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof resendExpiryWarning>>,
  TError,
  { id: string; params: ResendExpiryWarningParams },
  TContext
> => {
  const mutationKey = ["resendExpiryWarning"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof resendExpiryWarning>>,
    { id: string; params: ResendExpiryWarningParams }
  > = (props) => {
    const { id, params } = props ?? {};

    return resendExpiryWarning(id, params, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type ResendExpiryWarningMutationResult = NonNullable<
  Awaited<ReturnType<typeof resendExpiryWarning>>
>;

export type ResendExpiryWarningMutationError = ErrorType<unknown>;

/**
 * @summary Resend a referral expiry warning
 */
export const useResendExpiryWarning = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof resendExpiryWarning>>,
    TError,
    { id: string; params: ResendExpiryWarningParams },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof resendExpiryWarning>>,
  TError,
  { id: string; params: ResendExpiryWarningParams },
  TContext
> => {
  return useMutation(getResendExpiryWarningMutationOptions(options));
};

/**
 * @summary Resend a referral bonus release notification
 */
export const getResendBonusReleaseUrl = (id: string) => {
  return `/api/referrals/${id}/resend-bonus-release`;
};

export const resendBonusRelease = async (
  id: string,
  options?: RequestInit,
): Promise<Referral> => {
  return customFetch<Referral>(getResendBonusReleaseUrl(id), {
    ...options,
    method: "POST",
  });
};

export const getResendBonusReleaseMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof resendBonusRelease>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof resendBonusRelease>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["resendBonusRelease"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof resendBonusRelease>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return resendBonusRelease(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type ResendBonusReleaseMutationResult = NonNullable<
  Awaited<ReturnType<typeof resendBonusRelease>>
>;

export type ResendBonusReleaseMutationError = ErrorType<unknown>;

/**
 * @summary Resend a referral bonus release notification
 */
export const useResendBonusRelease = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof resendBonusRelease>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof resendBonusRelease>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getResendBonusReleaseMutationOptions(options));
};

/**
 * @summary Reverse a converted referral bonus
 */
export const getReverseReferralBonusUrl = (id: string) => {
  return `/api/referrals/${id}/reverse`;
};

export const reverseReferralBonus = async (
  id: string,
  reverseReferralBonusBody: ReverseReferralBonusBody,
  options?: RequestInit,
): Promise<Referral> => {
  return customFetch<Referral>(getReverseReferralBonusUrl(id), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(reverseReferralBonusBody),
  });
};

export const getReverseReferralBonusMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof reverseReferralBonus>>,
    TError,
    { id: string; data: BodyType<ReverseReferralBonusBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof reverseReferralBonus>>,
  TError,
  { id: string; data: BodyType<ReverseReferralBonusBody> },
  TContext
> => {
  const mutationKey = ["reverseReferralBonus"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof reverseReferralBonus>>,
    { id: string; data: BodyType<ReverseReferralBonusBody> }
  > = (props) => {
    const { id, data } = props ?? {};

    return reverseReferralBonus(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type ReverseReferralBonusMutationResult = NonNullable<
  Awaited<ReturnType<typeof reverseReferralBonus>>
>;
export type ReverseReferralBonusMutationBody =
  BodyType<ReverseReferralBonusBody>;
export type ReverseReferralBonusMutationError = ErrorType<unknown>;

/**
 * @summary Reverse a converted referral bonus
 */
export const useReverseReferralBonus = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof reverseReferralBonus>>,
    TError,
    { id: string; data: BodyType<ReverseReferralBonusBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof reverseReferralBonus>>,
  TError,
  { id: string; data: BodyType<ReverseReferralBonusBody> },
  TContext
> => {
  return useMutation(getReverseReferralBonusMutationOptions(options));
};

/**
 * @summary Financially reverse an already paid referral bonus
 */
export const getReversePaidReferralBonusUrl = (id: string) => {
  return `/api/referrals/${id}/reverse-paid-bonus`;
};

export const reversePaidReferralBonus = async (
  id: string,
  reversePaidReferralBonusBody: ReversePaidReferralBonusBody,
  options?: RequestInit,
): Promise<ReversePaidReferralBonusResponse> => {
  return customFetch<ReversePaidReferralBonusResponse>(
    getReversePaidReferralBonusUrl(id),
    {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json", ...options?.headers },
      body: JSON.stringify(reversePaidReferralBonusBody),
    },
  );
};

export const getReversePaidReferralBonusMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof reversePaidReferralBonus>>,
    TError,
    { id: string; data: BodyType<ReversePaidReferralBonusBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof reversePaidReferralBonus>>,
  TError,
  { id: string; data: BodyType<ReversePaidReferralBonusBody> },
  TContext
> => {
  const mutationKey = ["reversePaidReferralBonus"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof reversePaidReferralBonus>>,
    { id: string; data: BodyType<ReversePaidReferralBonusBody> }
  > = (props) => {
    const { id, data } = props ?? {};

    return reversePaidReferralBonus(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type ReversePaidReferralBonusMutationResult = NonNullable<
  Awaited<ReturnType<typeof reversePaidReferralBonus>>
>;
export type ReversePaidReferralBonusMutationBody =
  BodyType<ReversePaidReferralBonusBody>;
export type ReversePaidReferralBonusMutationError = ErrorType<unknown>;

/**
 * @summary Financially reverse an already paid referral bonus
 */
export const useReversePaidReferralBonus = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof reversePaidReferralBonus>>,
    TError,
    { id: string; data: BodyType<ReversePaidReferralBonusBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof reversePaidReferralBonus>>,
  TError,
  { id: string; data: BodyType<ReversePaidReferralBonusBody> },
  TContext
> => {
  return useMutation(getReversePaidReferralBonusMutationOptions(options));
};

/**
 * @summary Send a referral WhatsApp test message to the configured agency number
 */
export const getTestWhatsAppMessageUrl = () => {
  return `/api/referral-settings/test-whatsapp`;
};

export const testWhatsAppMessage = async (
  testWhatsAppMessageBody: TestWhatsAppMessageBody,
  options?: RequestInit,
): Promise<TestWhatsAppMessageResult> => {
  return customFetch<TestWhatsAppMessageResult>(getTestWhatsAppMessageUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(testWhatsAppMessageBody),
  });
};

export const getTestWhatsAppMessageMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof testWhatsAppMessage>>,
    TError,
    { data: BodyType<TestWhatsAppMessageBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof testWhatsAppMessage>>,
  TError,
  { data: BodyType<TestWhatsAppMessageBody> },
  TContext
> => {
  const mutationKey = ["testWhatsAppMessage"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof testWhatsAppMessage>>,
    { data: BodyType<TestWhatsAppMessageBody> }
  > = (props) => {
    const { data } = props ?? {};

    return testWhatsAppMessage(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type TestWhatsAppMessageMutationResult = NonNullable<
  Awaited<ReturnType<typeof testWhatsAppMessage>>
>;
export type TestWhatsAppMessageMutationBody = BodyType<TestWhatsAppMessageBody>;
export type TestWhatsAppMessageMutationError = ErrorType<unknown>;

/**
 * @summary Send a referral WhatsApp test message to the configured agency number
 */
export const useTestWhatsAppMessage = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof testWhatsAppMessage>>,
    TError,
    { data: BodyType<TestWhatsAppMessageBody> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof testWhatsAppMessage>>,
  TError,
  { data: BodyType<TestWhatsAppMessageBody> },
  TContext
> => {
  return useMutation(getTestWhatsAppMessageMutationOptions(options));
};
