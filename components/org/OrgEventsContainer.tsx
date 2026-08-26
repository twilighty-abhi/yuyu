"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Paper from "@mui/material/Paper";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import IconButton from "@mui/material/IconButton";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import GridViewIcon from "@mui/icons-material/GridView";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import Link from "next/link";
import { DiscoverEventCard } from "@/components/event/DiscoverEventCard";
import { InstanceCard } from "@/components/event/InstanceCard";

type MergedItem =
  | {
      kind: "event";
      id: string;
      startDateTime: Date;
      endDateTime: Date;
      title: string;
      description: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event: any;
    }
  | {
      kind: "instance";
      id: string;
      startDateTime: Date;
      endDateTime: Date;
      title: string;
      description: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instance: any;
    };

type OrgEventsContainerProps = {
  orgSlug: string;
  organisationName: string;
  initialNow: string;
  items: MergedItem[];
};

export function OrgEventsContainer({ orgSlug, organisationName, initialNow, items }: OrgEventsContainerProps) {
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");
  const [viewMode, setViewMode] = useState<"grid" | "calendar">("grid");

  // Use the server snapshot for the initial render so event grouping hydrates
  // consistently, then adopt the browser's clock after hydration.
  const [now, setNow] = useState(() => new Date(initialNow));
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const localNow = new Date();
      setNow(localNow);
      setCurrentMonth(localNow.getMonth());
      setCurrentYear(localNow.getFullYear());
      setSelectedDay(localNow.getDate());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Filter items by time status
  const filteredItems = items.filter((item) => {
    const start = new Date(item.startDateTime);
    const isUpcoming = start >= now;
    return activeTab === "upcoming" ? isUpcoming : !isUpcoming;
  });

  // Calendar Helpers
  const startOfMonth = new Date(currentYear, currentMonth, 1);
  const endOfMonth = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = endOfMonth.getDate();
  const startDayOfWeek = startOfMonth.getDay(); // 0: Sunday, 6: Saturday

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
    setSelectedDay(null);
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
    setSelectedDay(null);
  };

  const monthName = startOfMonth.toLocaleString("default", { month: "long" });

  // Get events starting on a specific day in the currently displayed month
  const getEventsForDay = (dayNum: number) => {
    return filteredItems.filter((item) => {
      const d = new Date(item.startDateTime);
      return (
        d.getFullYear() === currentYear &&
        d.getMonth() === currentMonth &&
        d.getDate() === dayNum
      );
    });
  };

  // Generate calendar grid slots
  const gridSlots = [];
  // Prefix empty slots
  for (let i = 0; i < startDayOfWeek; i++) {
    gridSlots.push({ type: "empty", key: `empty-${i}` });
  }
  // Days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    gridSlots.push({ type: "day", dayNum: i, key: `day-${i}` });
  }

  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : [];

  return (
    <Stack spacing={3}>
      {/* Header controls (Tabs on left, ViewMode Toggle on right) */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { xs: "stretch", sm: "center" },
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          pb: 1,
        }}
      >
        <Tabs
          value={activeTab}
          onChange={(_, val) => {
            setActiveTab(val);
            setViewMode("grid"); // Default back to grid on tab switch to avoid confusion
          }}
          textColor="primary"
          indicatorColor="primary"
          sx={{ minHeight: 40 }}
        >
          <Tab label="Upcoming Events" value="upcoming" sx={{ fontWeight: 600, py: 1 }} />
          <Tab label="Past Events" value="past" sx={{ fontWeight: 600, py: 1 }} />
        </Tabs>

        <ButtonGroup size="small" aria-label="view mode toggle" sx={{ alignSelf: "flex-end" }}>
          <Button
            variant={viewMode === "grid" ? "contained" : "outlined"}
            onClick={() => setViewMode("grid")}
            startIcon={<GridViewIcon />}
            sx={{ fontWeight: 600 }}
          >
            Grid
          </Button>
          <Button
            variant={viewMode === "calendar" ? "contained" : "outlined"}
            onClick={() => setViewMode("calendar")}
            startIcon={<CalendarMonthIcon />}
            sx={{ fontWeight: 600 }}
          >
            Calendar
          </Button>
        </ButtonGroup>
      </Stack>

      {/* Grid View */}
      {viewMode === "grid" && (
        <>
          {filteredItems.length === 0 ? (
            <Paper
              variant="outlined"
              sx={{
                p: 5,
                borderRadius: 4,
                textAlign: "center",
                backgroundColor: "rgba(255,255,255,0.01)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                No events found
              </Typography>
              <Typography color="text.secondary">
                There are no {activeTab} events listed at the moment.
              </Typography>
            </Paper>
          ) : (
            <Grid container spacing={3}>
              {filteredItems.map((item) =>
                item.kind === "event" ? (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={item.id}>
                    <DiscoverEventCard
                      orgSlug={orgSlug}
                      organisationName={organisationName}
                      event={item.event}
                    />
                  </Grid>
                ) : (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={item.id}>
                    <InstanceCard
                      orgSlug={orgSlug}
                      instanceId={item.instance.id}
                      title={item.instance.series.title}
                      description={item.instance.series.description}
                      startDateTime={item.instance.startDateTime}
                      endDateTime={item.instance.endDateTime}
                      timezone={item.instance.series.timezone}
                    />
                  </Grid>
                )
              )}
            </Grid>
          )}
        </>
      )}

      {/* Calendar View */}
      {viewMode === "calendar" && (
        <Stack spacing={3}>
          {/* Calendar Card Container */}
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              borderRadius: 4,
              backgroundColor: "rgba(255, 255, 255, 0.01)",
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            {/* Month & Navigation Header */}
            <Stack
              direction="row"
              spacing={2}
              sx={{ justifyContent: "space-between", alignItems: "center", mb: 3 }}
            >
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {monthName} {currentYear}
              </Typography>
              <Stack direction="row" spacing={1}>
                <IconButton onClick={prevMonth} size="small" sx={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <ChevronLeftIcon />
                </IconButton>
                <IconButton onClick={nextMonth} size="small" sx={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <ChevronRightIcon />
                </IconButton>
              </Stack>
            </Stack>

            {/* Calendar Grid */}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 1,
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 2,
                overflow: "hidden",
                backgroundColor: "rgba(0,0,0,0.15)",
              }}
            >
              {/* Day header cells */}
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
                <Box
                  key={dayName}
                  sx={{
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: "0.75rem",
                    color: "rgba(255,255,255,0.4)",
                    py: 1,
                    backgroundColor: "rgba(255,255,255,0.02)",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {dayName}
                </Box>
              ))}

              {gridSlots.map((slot) => {
                if (slot.type === "empty") {
                  return (
                    <Box
                      key={slot.key}
                      sx={{
                        minHeight: { xs: "50px", md: "110px" },
                        backgroundColor: "transparent",
                      }}
                    />
                  );
                }

                const dayNum = slot.dayNum!;
                const dayEvents = getEventsForDay(dayNum);
                const hasEvents = dayEvents.length > 0;
                const isSelected = selectedDay === dayNum;
                const isToday =
                  now.getDate() === dayNum &&
                  now.getMonth() === currentMonth &&
                  now.getFullYear() === currentYear;

                return (
                  <Box
                    key={slot.key}
                    onClick={() => setSelectedDay(dayNum)}
                    sx={{
                      minHeight: { xs: "50px", md: "110px" },
                      p: 1,
                      cursor: "pointer",
                      border: isSelected
                        ? "1px solid #7CF5B6"
                        : "1px solid rgba(255, 255, 255, 0.04)",
                      backgroundColor: isSelected
                        ? "rgba(124, 245, 182, 0.05)"
                        : hasEvents
                        ? "rgba(255, 255, 255, 0.02)"
                        : "transparent",
                      transition: "all 0.15s ease",
                      position: "relative",
                      "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
                      },
                    }}
                  >
                    {/* Day number label */}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        fontSize: "0.8rem",
                        fontWeight: isToday || hasEvents ? 700 : 500,
                        color: isToday
                          ? "#7CF5B6"
                          : hasEvents
                          ? "#ffffff"
                          : "rgba(255,255,255,0.6)",
                        backgroundColor: isToday ? "rgba(124, 245, 182, 0.15)" : "transparent",
                        mb: 1,
                      }}
                    >
                      {dayNum}
                    </Box>

                    {/* Desktop events list */}
                    <Box sx={{ display: { xs: "none", md: "block" } }}>
                      {dayEvents.map((item) => (
                        <Box
                          component={Link}
                          href={
                            item.kind === "event"
                              ? `/${orgSlug}/${item.event.slug}`
                              : `/${orgSlug}/i/${item.instance.id}`
                          }
                          key={item.id}
                          sx={{
                            display: "block",
                            fontSize: "10px",
                            lineHeight: 1.2,
                            p: 0.5,
                            borderRadius: 1,
                            backgroundColor:
                              item.kind === "event"
                                ? "rgba(124, 245, 182, 0.08)"
                                : "rgba(185, 174, 255, 0.08)",
                            color: item.kind === "event" ? "#7CF5B6" : "#B9AEFF",
                            border: `1px solid ${
                              item.kind === "event"
                                ? "rgba(124, 245, 182, 0.15)"
                                : "rgba(185, 174, 255, 0.15)"
                            }`,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            textDecoration: "none",
                            mb: 0.5,
                            "&:hover": {
                              backgroundColor:
                                item.kind === "event"
                                  ? "rgba(124, 245, 182, 0.18)"
                                  : "rgba(185, 174, 255, 0.18)",
                            },
                          }}
                        >
                          {item.title}
                        </Box>
                      ))}
                    </Box>

                      {/* Mobile events dot indicators */}
                      <Box
                        sx={{
                          display: { xs: "flex", md: "none" },
                          gap: 0.5,
                          justifyContent: "center",
                          position: "absolute",
                          bottom: 4,
                          left: 0,
                          right: 0,
                        }}
                      >
                        {dayEvents.slice(0, 3).map((item) => (
                          <Box
                            key={item.id}
                            sx={{
                              width: 5,
                              height: 5,
                              borderRadius: "50%",
                              backgroundColor: item.kind === "event" ? "#7CF5B6" : "#B9AEFF",
                            }}
                          />
                        ))}
                      </Box>
                  </Box>
                );
              })}
            </Box>
          </Paper>

          {/* Selected Date events drawer list (especially critical for Mobile view) */}
          {selectedDay && (
            <Paper
              variant="outlined"
              sx={{
                p: 3,
                borderRadius: 4,
                backgroundColor: "rgba(255, 255, 255, 0.015)",
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                Events on {monthName} {selectedDay}, {currentYear}
              </Typography>
              {selectedDayEvents.length === 0 ? (
                <Typography color="text.secondary">
                  No events scheduled for this date.
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  {selectedDayEvents.map((item) =>
                    item.kind === "event" ? (
                      <Grid size={{ xs: 12, sm: 6, md: 4 }} key={item.id}>
                        <DiscoverEventCard
                          orgSlug={orgSlug}
                          organisationName={organisationName}
                          event={item.event}
                        />
                      </Grid>
                    ) : (
                      <Grid size={{ xs: 12, sm: 6, md: 4 }} key={item.id}>
                        <InstanceCard
                          orgSlug={orgSlug}
                          instanceId={item.instance.id}
                          title={item.instance.series.title}
                          description={item.instance.series.description}
                          startDateTime={item.instance.startDateTime}
                          endDateTime={item.instance.endDateTime}
                          timezone={item.instance.series.timezone}
                        />
                      </Grid>
                    )
                  )}
                </Grid>
              )}
            </Paper>
          )}
        </Stack>
      )}
    </Stack>
  );
}
