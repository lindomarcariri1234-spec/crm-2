import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Início</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="reservas">
        <Icon sf={{ default: "calendar", selected: "calendar.circle.fill" }} />
        <Label>Reservas</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="memorias">
        <Icon sf={{ default: "photo", selected: "photo.fill" }} />
        <Label>Álbum</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="fidelidade">
        <Icon sf={{ default: "star", selected: "star.fill" }} />
        <Label>Fidelidade</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="indicacoes">
        <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <Label>Indicações</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="perfil">
        <Icon sf={{ default: "person.circle", selected: "person.circle.fill" }} />
        <Label>Perfil</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notificacoes">
        <Icon sf={{ default: "bell", selected: "bell.fill" }} />
        <Label>Avisos</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: true,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            />
          ) : null,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Início",
          tabBarLabel: "Início",
          headerShown: false,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="reservas"
        options={{
          title: "Minhas Reservas",
          tabBarLabel: "Reservas",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="calendar" tintColor={color} size={24} />
            ) : (
              <Feather name="calendar" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="memorias"
        options={{
          title: "Álbum de Viagens",
          tabBarLabel: "Álbum",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="photo.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="camera" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="fidelidade"
        options={{
          title: "Fidelidade",
          tabBarLabel: "Fidelidade",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="star.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="star" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="indicacoes"
        options={{
          title: "Indicações",
          tabBarLabel: "Indicações",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="users" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Meu Perfil",
          tabBarLabel: "Perfil",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.circle.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="user" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="notificacoes"
        options={{
          title: "Notificações",
          tabBarLabel: "Avisos",
          tabBarIcon: ({ color }) => <Feather name="bell" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
