import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Feather, FontAwesome5, MaterialIcons } from "@expo/vector-icons";

export default function SupportedTestsScreen() {
  const [searchQuery, setSearchQuery] = useState("");

  // Test data
  const tests = [
    { name: "Auscultation (Lungs)", icon: "wind", iconType: "feather" },
    { name: "Auscultation (Heart)", icon: "heart", iconType: "fontAwesome" },
    { name: "Pharyngoscopy", icon: "user-md", iconType: "fontAwesome" },
    { name: "Auscultation (Stomach)", icon: "pie-chart", iconType: "feather" },
    { name: "Odontology", icon: "tooth", iconType: "fontAwesome" },
    { name: "Oncology", icon: "clipboard-list", iconType: "fontAwesome" },
    { name: "Ophthalmology", icon: "eye", iconType: "feather" },
    { name: "Orthology", icon: "bone", iconType: "fontAwesome" },
    { name: "Otoscopy", icon: "hearing", iconType: "material" },
    { name: "Dermatoscopy", icon: "fingerprint", iconType: "material" },
    { name: "Gynecology", icon: "female", iconType: "fontAwesome" },
  ];

  // Filter tests based on search query
  const filteredTests = tests.filter((test) =>
    test.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderIcon = (item: any) => {
    const iconColor = "#FFFFFF";

    if (item.iconType === "feather") {
      return <Feather name={item.icon} size={32} color={iconColor} />;
    } else if (item.iconType === "fontAwesome") {
      return <FontAwesome5 name={item.icon} size={32} color={iconColor} />;
    } else if (item.iconType === "material") {
      return <MaterialIcons name={item.icon} size={32} color={iconColor} />;
    }
  };

  const handleTestSelect = (testName: string) => {
    // Check if it's an imaging test or auscultation test
    if (["Pharyngoscopy", "Otoscopy", "Dermatoscopy"].includes(testName)) {
      router.push({
        pathname: "/imaging",
        params: { testName },
      });
    } else if (testName.startsWith("Auscultation")) {
      router.push({
        pathname: "/auscultation",
        params: { testName },
      });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={24} color="#1E293B" />
          </TouchableOpacity>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>Supported Tests</Text>
            <Text style={styles.subtitle}>Find Your Test</Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Feather
            name="search"
            size={18}
            color="#64748B"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Sort and Filter */}
        <View style={styles.sortFilterContainer}>
          <View style={styles.sortByContainer}>
            <Text style={styles.sortByText}>Sort By</Text>
            <TouchableOpacity style={styles.azButton}>
              <Text style={styles.azButtonText}>A-Z</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.filterButton}>
            <Feather name="filter" size={16} color="#4A90E2" />
            <Text style={styles.filterText}>Filter</Text>
          </TouchableOpacity>
          <Text style={styles.testsCountText}>Tests</Text>
        </View>

        {/* Tests Grid */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollViewContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.testsGrid}>
            {filteredTests.map((test, index) => (
              <TouchableOpacity
                key={index}
                style={styles.testCard}
                onPress={() => handleTestSelect(test.name)}
              >
                <LinearGradient
                  colors={["#4A90E2", "#5AC8FA"]}
                  style={styles.gradient}
                >
                  {renderIcon(test)}
                  <Text style={styles.testName}>{test.name}</Text>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 25 : 0,
  },
  container: {
    flex: 1,
    paddingTop: 10,
  },
  header: {
    padding: 16,
    paddingTop: 8,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  backButton: {
    marginRight: 16,
    marginTop: 4,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1E293B",
  },
  subtitle: {
    fontSize: 16,
    color: "#64748B",
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 16,
    color: "#1E293B",
  },
  sortFilterContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginVertical: 16,
  },
  sortByContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  sortByText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1E293B",
    marginRight: 8,
  },
  azButton: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  azButtonText: {
    color: "#4A90E2",
    fontWeight: "bold",
    fontSize: 14,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  filterText: {
    color: "#4A90E2",
    fontWeight: "500",
    fontSize: 14,
    marginLeft: 6,
  },
  testsCountText: {
    fontSize: 14,
    color: "#64748B",
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    padding: 16,
    paddingBottom: 24,
  },
  testsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  testCard: {
    width: "48%",
    aspectRatio: 1,
    marginBottom: 16,
    borderRadius: 16,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  gradient: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  testName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 12,
  },
});
