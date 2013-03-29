ActionTest = AsyncTestCase( "ActionTest" );

/**
 * Test that variables are defined
 */
ActionTest.prototype.test__source_is_well_formed = function()
{
  assertTrue( Action != null );
  assertTrue( Action.dispatch != null );
};

//-------------------------------------------------------
// Utility
//-------------------------------------------------------

//-------------------------------------------------------
// Generic tests
//-------------------------------------------------------
/**
 *
 * @param {Action.Asynchronous_Action} action
 * @param {string} state_name
 */
function verify_state( action, state_name )
{
  var expected = Action.State[ state_name ];
  assertEquals( "action state is not '" + state_name + "'.", expected, action.state );
}

/**
 * Check that an action executes its body and returns. Generic for simple, non-compound actions.
 *
 * @param {function(function):Action.Asynchronous_Action} factory
 *    A factory function that yields an action.
 * @param queue
 */
function simple_try( factory, queue )
{
  /**
   * @type {Action.Asynchronous_Action}
   */
  var d = null;
  var sequence = 0;

  function trial()
  {
    verify_state( d, "Running" );
    sequence += 1;
  }

  queue.call( "Go phase.", function( callbacks )
  {
    var monitored_trial = callbacks.add( trial );
    d = factory( monitored_trial );
    verify_state( d, "Ready" );
    assertEquals( 0, sequence );
    d.go();
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
  } );

  queue.call( "End phase.", function()
  {
    verify_state( d, "Done" );
    assertEquals( 1, sequence );
  } );
}

/**
 * Check that an action executes its body and the finisher function and returns. Generic for simple, non-compound
 * actions. Verifying execution is done with both direct and indirect means.
 *
 * @param {function} factory
 *    A factory function that yields an action.
 * @param queue
 */
function simple_finally( factory, queue )
{
  /**
   * @type {Action.Asynchronous_Action}
   */
  var d;
  var sequence = 0;

  function trial()
  {
    verify_state( d, "Running" );
    sequence += 1;
  }

  function catcher()
  {
    fail( "Action under test should not throw an exception nor call its catcher." );
  }

  function finisher()
  {
    verify_state( d, "Done" );
    sequence += 2;
  }

  queue.call( "Go phase.", function( callbacks )
  {
    var monitored_trial = callbacks.add( trial );
    d = factory( monitored_trial );
    var monitored_finisher = callbacks.add( finisher );
    verify_state( d, "Ready" );
    assertEquals( 0, sequence );
    d.go( monitored_finisher, catcher );
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
  } );

  queue.call( "End phase.", function()
  {
    verify_state( d, "Done" );
    assertEquals( 3, sequence );
  } );
}

/**
 * Run a simple trial, one that throws an exception, with both finisher and catcher. Indirectly verify that all
 * three run, but directly verify only the finally and catch.
 *
 * Generic for simple non-compound actions.
 *
 * @param {function} factory
 *    A factory function that yields an action.
 * @param queue
 */
function simple_catch( factory, queue )
{
  /**
   * @type {Action.Asynchronous_Action}
   */
  var d;
  var sequence = 0;

  function trial()
  {
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
    sequence += 1;
    throw new Error( "This error is part of the test." );
  }

  function catcher()
  {
    verify_state( d, "Exception" );
    assertEquals( 1, sequence );
    sequence += 2;
  }

  function finisher()
  {
    verify_state( d, "Exception" );
    assertEquals( 3, sequence );
    sequence += 4;
  }

  queue.call( "Go phase.", function( callbacks )
  {
    /* If we monitor the trial by adding to the callback list, it will report the exception as an error, which is not
     * what we want. We indirectly test that it runs by incrementing the sequence number.
     */
    d = factory( trial );
    var monitored_catch = callbacks.add( catcher );
    var monitored_finally = callbacks.add( finisher );
    verify_state( d, "Ready" );
    assertEquals( 0, sequence );
    d.go( monitored_finally, monitored_catch );
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
  } );

  queue.call( "End phase.", function()
  {
    verify_state( d, "Exception" );
    assertEquals( 7, sequence );
  } );
}


//-------------------------------------------------------
// Defer
//-------------------------------------------------------
/**
 * Factory for Defer objects
 * @param trial
 * @return {Action.Defer}
 */
function defer_factory( trial )
{
  return new Action.Defer( trial );
}

ActionTest.prototype.test_defer_try = function( queue )
{
  simple_try( defer_factory, queue );
};

ActionTest.prototype.test_defer_finally = function( queue )
{
  simple_finally( defer_factory, queue );
};

ActionTest.prototype.test_defer_catch = function( queue )
{
  simple_catch( defer_factory, queue );
};

//-------------------------------------------------------
// Delay
//-------------------------------------------------------

/**
 * Factory for Delay objects
 * @param delay
 * @param trial
 * @return {Action.Delay}
 */
function delay_factory( delay, trial )
{
  return new Action.Delay( trial, delay );
}

function simple_delay_factory( trial )
{
  return delay_factory( 2, trial );
}

ActionTest.prototype.test_delay_tries = function( queue )
{
  simple_try( simple_delay_factory, queue );
};

ActionTest.prototype.test_delay_finally = function( queue )
{
  simple_finally( simple_delay_factory, queue );
};

ActionTest.prototype.test_delay_catch = function( queue )
{
  simple_catch( simple_delay_factory, queue );
};


//-------------------------------------------------------
// Join
//-------------------------------------------------------
ActionTest.prototype.test_join__throw_on_null_constructor_argument = function( queue )
{
  try
  {
    var join = new Action.Join( null );
    fail( "Join must throw an exception when passed a null constructor argument." );
  }
  catch ( e )
  {
    // Exception is what's supposed to happen.
  }
};

function join_test( variation, queue )
/**
 * Combined variations on a number of simple join tests. There's an ordinary action and a join that it depends upon.
 * Both are invoked. The ordinary action executes first and then the join does.
 *
 * There are four operations {construct, go} x {ordinary, join} and some ordering dependencies. The construction of the
 * join must come after that of the ordinary action. Each invocation must come after construction. Given these
 * constraints, there are three possible orders.
 *
 * @param variation
 * @param queue
 */
{
  var sequence = 0;
  var defer = null, join = null;

  function deferred_trial()
  {
    // The Defer instance should run first
    verify_state( defer, "Running" );
    verify_state( join, "Running" );
    assertEquals( "deferred trial. sequence", 0, sequence );
    sequence += 1;
  }

  function joined_catcher()
  {
    fail( "Joined catcher should not be called." );
  }

  function joined_finisher()
  {
    // The Join instance should run second.
    verify_state( defer, "Done" );
    verify_state( join, "Done" );
    assertEquals( "joined finisher. sequence", 1, sequence );
    sequence += 2;
  }

  function make_join()
  {
    join = new Action.Join( defer );
    verify_state( join, "Ready" );
  }

  function join_go( callbacks )
  {
    join.go( callbacks.add( joined_finisher, null, 2000, "joined finisher" ), joined_catcher );
  }

  queue.call( "Phase[1]=Go.", function( callbacks )
  {
    /*
     * Construction of the Defer instance always has to come first.
     */
    defer = new Action.Defer( callbacks.add( deferred_trial ) );
    verify_state( defer, "Ready" );
    switch ( variation )
    {
      case "existing ready":
        /*
         * Invoke the join before the defer has been invoked. This tests joining to a ready action.
         */
        make_join();
        join_go( callbacks );
        defer.go();
        break;
      case "existing running":
        /*
         * Invoke the join after the defer has been invoked. This tests joining to a running action.
         */
        make_join();
        defer.go();
        join_go( callbacks );
        break;
      case "new running":
        /*
         * Construct the join after defer has already been invoked.
         */
        defer.go();
        make_join();
        join_go( callbacks );
        break;
      default:
        throw new Error( "unknown variation" );
    }
    verify_state( defer, "Running" );
    verify_state( join, "Running" );
  } );

  queue.call( "Phase[2]=End.", function( callbacks )
  {
    verify_state( defer, "Done" );
    verify_state( join, "Done" );
    assertEquals( 3, sequence );
  } );
}

ActionTest.prototype.test_join__existing_join_to_new_defer_instance = function( queue )
{
  join_test( "existing ready", queue );
};

ActionTest.prototype.test_join__existing_join_to_running_defer_instance = function( queue )
{
  join_test( "existing running", queue );
};

ActionTest.prototype.test_join__new_join_to_running_defer_instance = function( queue )
{
  join_test( "new running", queue )
};