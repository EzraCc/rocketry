import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import info.openrocket.core.aerodynamics.BarrowmanCalculator;
import info.openrocket.core.aerodynamics.FlightConditions;
import info.openrocket.core.document.OpenRocketDocument;
import info.openrocket.core.document.Simulation;
import info.openrocket.core.file.GeneralRocketLoader;
import info.openrocket.core.logging.WarningSet;
import info.openrocket.core.motor.Motor;
import info.openrocket.core.motor.MotorConfiguration;
import info.openrocket.core.rocketcomponent.BodyTube;
import info.openrocket.core.rocketcomponent.ComponentChangeEvent;
import info.openrocket.core.rocketcomponent.FlightConfiguration;
import info.openrocket.core.rocketcomponent.FlightConfigurationId;
import info.openrocket.core.rocketcomponent.MotorMount;
import info.openrocket.core.rocketcomponent.Rocket;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.simulation.FlightData;
import info.openrocket.core.simulation.FlightDataBranch;
import info.openrocket.core.simulation.FlightDataType;
import info.openrocket.core.simulation.FlightEvent;
import info.openrocket.core.startup.Application;
import info.openrocket.core.startup.OpenRocketCore;
import info.openrocket.core.util.CoordinateIF;

import java.io.File;
import java.io.FileWriter;
import java.nio.file.Files;
import java.util.List;

/**
 * Validation oracle: loads a rocketry library .rkt file through OpenRocket's real Java core
 * (the same physics/parsing this project is independently re-deriving, not reproducing), attaches
 * a real motor from OpenRocket's own bundled thrustcurve database, computes CP and runs a full
 * ascent simulation, and writes the results as JSON for validation/openrocket-comparison.test.ts
 * to check our own engine against.
 *
 * See validation/openrocket-oracle/README.md for what this is and how to (re-)run it -- built to
 * be cheap to re-invoke, not a one-shot script: `run.sh` is the one command to remember, and
 * rockets.json is the only file that needs editing to add/change cases.
 */
public class RocketryOracle {
  // Mach 0.1 (~100fps, off-the-rail) -- matches the live UI's own reference speed (see main.ts)
  // and validation/rocksim-embedded-cp.test.ts's comparison Mach, so all three (OpenRocket, our
  // engine, RockSim's own stored value) are checked at a consistent, physically-representative
  // speed.
  private static final double COMPARISON_MACH = 0.1;

  public static void main(String[] args) throws Exception {
    String repoDir = System.getenv("ROCKETRY_REPO_DIR");
    if (repoDir == null || repoDir.isEmpty()) {
      throw new IllegalStateException("ROCKETRY_REPO_DIR not set -- run via run.sh, not this class directly");
    }

    OpenRocketCore.initialize();

    File manifestFile = new File(repoDir, "validation/openrocket-oracle/rockets.json");
    File outDir = new File(repoDir, "validation/fixtures/openrocket");
    Files.createDirectories(outDir.toPath());

    Gson gson = new GsonBuilder().setPrettyPrinting().create();
    JsonArray manifest = JsonParser.parseString(Files.readString(manifestFile.toPath())).getAsJsonArray();

    int okCount = 0;
    int failCount = 0;
    for (int i = 0; i < manifest.size(); i++) {
      JsonObject entry = manifest.get(i).getAsJsonObject();
      String label = entry.get("label").getAsString();
      String rocketPath = entry.get("rocketPath").getAsString();
      String motorManufacturer = entry.get("motorManufacturer").getAsString();
      String motorDesignation = entry.get("motorDesignation").getAsString();

      System.out.println("=== " + label + " ===");
      try {
        JsonObject result = runCase(new File(repoDir, rocketPath), motorManufacturer, motorDesignation);
        result.addProperty("label", label);
        result.addProperty("rocketPath", rocketPath);
        result.addProperty("motorManufacturer", motorManufacturer);
        result.addProperty("motorDesignation", motorDesignation);

        File outFile = new File(outDir, label + ".json");
        try (FileWriter w = new FileWriter(outFile)) {
          gson.toJson(result, w);
        }
        System.out.println("  wrote " + outFile);
        okCount++;
      } catch (Exception e) {
        System.out.println("  FAILED: " + e);
        e.printStackTrace(System.out);
        failCount++;
      }
    }

    System.out.println("\n" + okCount + " ok, " + failCount + " failed, " + manifest.size() + " total");
    if (failCount > 0) {
      System.exit(1);
    }
  }

  private static JsonObject runCase(File rocketFile, String motorManufacturer, String motorDesignation) throws Exception {
    GeneralRocketLoader loader = new GeneralRocketLoader(rocketFile);
    OpenRocketDocument doc = loader.load();
    Rocket rocket = doc.getRocket();

    MotorMount mount = findMotorMount(rocket);
    if (mount == null) {
      throw new IllegalStateException("No motor mount found in " + rocketFile.getName());
    }

    // Manufacturer is required (not null), not optional -- multiple vendors can share a bare
    // designation like "C6" (confirmed directly: ThrustCurve.org has both an Estes and a Quest
    // Aerospace C6). Without pinning it, this and the TS-side motor-fixture fetch used by the
    // comparison test could each independently resolve a DIFFERENT physical motor sharing the same
    // designation string, silently comparing two different motors against each other.
    List<? extends Motor> matches = Application.getMotorSetDatabase()
        .findMotors(null, null, motorManufacturer, motorDesignation, Double.NaN, Double.NaN);
    if (matches.isEmpty()) {
      throw new IllegalStateException(
          "No motor found for \"" + motorManufacturer + " " + motorDesignation + "\" in the bundled database");
    }
    Motor motor = matches.get(0);

    // A freshly-loaded .rkt has no real flight configuration of its own (RockSim has no such
    // concept at all) -- rocket.getSelectedConfiguration() returns the DEFAULT sentinel
    // configuration, whose id (FlightConfigurationId.DEFAULT_VALUE_FCID) is a special case
    // FlightConfigurableParameterSet.set() silently no-ops on (confirmed directly in its source:
    // "if a user wants to set the default value, make them do it explicitly with
    // .setDefaultValue(...)" -- a plain .set() for that id does nothing at all). Every motor-attach
    // call below would silently fail against that id, with no exception -- create and select a
    // REAL configuration first, exactly like Simulation's own constructor does internally when
    // given an fcid the rocket doesn't already contain.
    FlightConfiguration config = rocket.createFlightConfiguration(null);
    rocket.setSelectedConfiguration(config.getId());
    // FlightConfiguration's constructor defaults EVERY stage to inactive (confirmed directly:
    // FlightConfiguration.java's constructor calls _setAllStages(false)) -- without this,
    // getActiveComponents() (what updateMotors() below loops over) returns nothing at all, so the
    // motor mount is never found regardless of it genuinely having a motor attached. All this
    // project's library files are single-stage, but this is needed either way, not just for
    // multi-stage rockets.
    config.setAllStages();
    FlightConfigurationId fcid = config.getFlightConfigurationID();
    MotorConfiguration motorConfig = new MotorConfiguration(mount, fcid);
    motorConfig.setMotor(motor);
    // Plugged (no ejection charge ever fires) -- our own engine only models ascent-to-apogee with
    // no recovery deployment at all. An unplugged motor's ejection charge could fire before
    // apogee if its delay is shorter than time-to-apogee, deploying a parachute mid-boost-arc and
    // changing the drag profile -- not an apples-to-apples comparison against our engine's scope.
    motorConfig.setEjectionDelay(Motor.PLUGGED_DELAY);
    mount.setMotorConfig(motorConfig, fcid);
    // Neither of these is optional, confirmed by reading the actual source (not guessed):
    // (1) setMotorConfig alone does NOT notify listeners -- BodyTube.java's implementation just
    //     sets isActingMount=true and stores the config directly into a map; it never calls
    //     fireComponentChangeEvent itself (only setMotorMount()/the swing GUI's own
    //     fireTableDataChanged helper do).
    // (2) FlightConfiguration keeps its OWN cached copy of "which motors exist" (a private `motors`
    //     map, separate from what's stored on the mount) that's only rebuilt inside update() --
    //     confirmed there's no change-listener wired to auto-call it in this headless context.
    // Skipping either leaves hasMotors()/getActiveMotors() reporting empty despite the motor being
    // genuinely attached to the mount, and the simulation aborts with "No motors defined".
    ((RocketComponent) mount).fireComponentChangeEvent(ComponentChangeEvent.MOTOR_CHANGE);
    config.update();

    // --- CP, at the same off-the-rail Mach the live UI and RockSim-comparison test use ---
    BarrowmanCalculator calc = new BarrowmanCalculator();
    FlightConditions conditions = new FlightConditions(config);
    conditions.setMach(COMPARISON_MACH);
    CoordinateIF cp = calc.getCP(config, conditions, new WarningSet());

    // --- Full ascent simulation ---
    Simulation sim = new Simulation(rocket);
    sim.simulate();
    FlightData data = sim.getSimulatedData();
    if (sim.hasErrors()) {
      FlightEvent abort = data.getBranch(0).getFirstEvent(FlightEvent.Type.SIM_ABORT);
      String cause = abort != null ? String.valueOf(abort.getData()) : "(no SIM_ABORT event found, unexpected)";
      throw new IllegalStateException(
          "Simulation had errors for " + rocketFile.getName() + ": abort=" + cause + " warnings=" + data.getWarningSet());
    }
    FlightDataBranch branch = data.getBranch(0);

    // Liftoff (loaded) CG -- index 0 of the branch, same convention this project's own engine
    // already uses (combinedMassAt(rocket, massCurve, 0) in src/main.ts): propellant hasn't burned
    // yet at t=0, so it's numerically identical to the true liftoff value, and far simpler than
    // matching a LIFTOFF FlightEvent's time back to a branch index.
    List<Double> cgSeries = branch.get(FlightDataType.TYPE_CG_LOCATION);
    List<Double> massSeries = branch.get(FlightDataType.TYPE_MASS);
    double cgAtLiftoffM = cgSeries.get(0);
    // Liftoff (loaded) MASS too, same index-0 convention -- lets the comparison test back-solve a
    // dry mass/CG for our own engine via the identical moment-conservation math this project's own
    // UI already uses (rederiveDryCg in src/main.ts), so both sides start from the same loaded
    // configuration rather than each guessing a dry mass independently.
    double massAtLiftoffKg = massSeries.get(0);
    // Stability margin computed directly from CP/CG/diameter here rather than read from
    // OpenRocket's own TYPE_STABILITY series -- that series is NaN at t=0 in every case tried
    // (confirmed directly), presumably a divide-by-zero in its dynamic-pressure-dependent
    // calculation at zero velocity. (cp - cg)/diameter is exactly this project's own
    // stabilityMargin() formula (see src/physics/aero/barrowman.ts), so this is the more directly
    // comparable number anyway, not a workaround that changes what's being measured.
    double stabilityAtLiftoffCalibers = (cp.getX() - cgAtLiftoffM) / conditions.getRefLength();

    // Apogee event, for cross-checking against the summary accessors below -- with the motor
    // plugged, altitude is unimodal (rises to apogee, then falls under gravity/drag alone, no
    // deployment discontinuity), so FlightData's own getMaxAltitude()/getTimeToApogee() summary
    // accessors are reliable AND simpler than manually matching this event's time to a branch
    // index -- this is just a sanity check that the two agree.
    FlightEvent apogeeEvent = branch.getFirstEvent(FlightEvent.Type.APOGEE);
    double apogeeEventTimeS = apogeeEvent != null ? apogeeEvent.getTime() : Double.NaN;

    JsonObject result = new JsonObject();
    result.addProperty("cpXMm", cp.getX() * 1000.0);
    result.addProperty("cgAtLiftoffMm", cgAtLiftoffM * 1000.0);
    result.addProperty("massAtLiftoffKg", massAtLiftoffKg);
    result.addProperty("refDiameterMm", conditions.getRefLength() * 1000.0);
    result.addProperty("stabilityMarginCalibers", stabilityAtLiftoffCalibers);
    result.addProperty("apogeeAltitudeM", data.getMaxAltitude());
    result.addProperty("apogeeTimeS", data.getTimeToApogee());
    result.addProperty("apogeeEventTimeS", apogeeEventTimeS);
    result.addProperty("maxVelocityMs", data.getMaxVelocity());
    result.addProperty("maxMach", data.getMaxMachNumber());
    result.addProperty("maxAccelerationMs2", data.getMaxAcceleration());
    return result;
  }

  /**
   * Finds the rocket's motor mount -- preferring a component RockSimLoader already flagged as one
   * (from the file's own IsMotorMount tag), but falling back to the last BodyTube in the tree if
   * none was flagged. This project's own parseRocksimXml has the identical fallback (see its
   * doc comments) for the identical, confirmed reason: RockSim's IsMotorMount flag is unreliable
   * in ~2-3% of real files -- including, concretely, this project's own PK-48 LOC-IV.rkt reference
   * fixture, which is exactly why this fallback matters here and can't just be skipped.
   */
  private static MotorMount findMotorMount(Rocket rocket) {
    BodyTube lastBodyTube = null;
    for (RocketComponent c : rocket.getAllChildren()) {
      if (c instanceof MotorMount && ((MotorMount) c).isMotorMount()) {
        return (MotorMount) c;
      }
      if (c instanceof BodyTube) {
        lastBodyTube = (BodyTube) c;
      }
    }
    if (lastBodyTube != null) {
      lastBodyTube.setMotorMount(true);
      return lastBodyTube;
    }
    return null;
  }
}
